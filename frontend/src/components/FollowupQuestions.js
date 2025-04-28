import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getFollowupQuestions,
    submitFollowupResponses,
    getRecommendationsStatus
} from '../services/api';

// Define the possible statuses from the backend's /recommendations/status endpoint
const PipelineStatus = {
    PIPELINE_RUNNING: 'pipeline_running', // RAG is active, questions might appear
    GENERATING_REPORT: 'generating_report', // Report generation started/active
    READY: 'ready', // Report is complete and URL available
    ERROR: 'error', // An error occurred
    NOT_FOUND: 'not_found', // Session ID invalid or not found
    SESSION_CREATED: 'session_created', // Initial states
    STARTED: 'started',
};


const FollowupQuestions = ({ sessionId }) => {
    // --- States ---
    const [followupQuestions, setFollowupQuestions] = useState([]);
    const [initialLoading, setInitialLoading] = useState(true); // Renamed for clarity: only for initial page load
    const [isFetchingQuestions, setIsFetchingQuestions] = useState(false); // Track if a fetch is in progress
    const [answers, setAnswers] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(''); // For user-facing errors

    // --- Hooks and Refs ---
    const navigate = useNavigate();
    const pollingIntervalRef = useRef(null);
    const isMounted = useRef(true);

    // --- Fetch Follow-up Questions (Called by pollData) ---
    const fetchAndSetQuestions = useCallback(async () => {
        // Prevent concurrent fetches
        if (!isMounted.current || isFetchingQuestions) return;

        setIsFetchingQuestions(true);
        // console.log("Fetching followup questions...");

        try {
            const data = await getFollowupQuestions(sessionId);
            if (!isMounted.current) return; // Check mount status after await

            if (data === null || data === undefined) {
                console.warn("API returned null/undefined followup data.");
                // If data is null/undefined, maybe clear existing questions?
                // setFollowupQuestions([]); // Optional: uncomment if null means "no questions right now"
            } else {
                // More robust check: Only update state if the actual content differs
                setFollowupQuestions(currentQuestions => {
                    const currentIds = currentQuestions.map(q => q.question_id).sort().join(',');
                    const newIds = data.map(q => q.question_id).sort().join(',');

                    if (currentIds !== newIds) {
                        console.log("New questions detected, updating state.");
                        // Initialize answers only for new questions
                        setAnswers((prevAnswers) => {
                            const newAnswers = { ...prevAnswers };
                            data.forEach((q) => {
                                if (!(q.question_id in newAnswers)) {
                                    const fields = q.additional_fields || {};
                                    const multiOptions = fields.multiple_correct_answer_options || [];
                                    if (multiOptions.length > 0) {
                                        newAnswers[q.question_id] = { values: [], subjective_value: '' };
                                    } else {
                                        newAnswers[q.question_id] = '';
                                    }
                                }
                            });
                            // No need for needsUpdate flag, just return the potentially modified newAnswers
                            return newAnswers;
                        });
                        return data; // Update the questions list
                    }
                    // If IDs are the same, assume questions haven't changed, return the current state
                    return currentQuestions;
                });
            }
        } catch (fetchError) {
            if (!isMounted.current) return;
            console.error('Error retrieving follow-up questions:', fetchError);
            // Avoid setting persistent error here
        } finally {
            // Ensure fetching flag is reset even if errors occur
             if (isMounted.current) {
                setIsFetchingQuestions(false);
             }
        }
        // Intentionally removed `loading` from dependency array to stabilize the function reference
    }, [sessionId, isFetchingQuestions]); // Depends on sessionId and its own fetching state flag

    // --- Combined Polling Function ---
    const pollData = useCallback(async () => {
        if (!isMounted.current || !sessionId) return;

        // console.log("Polling cycle initiated...");
        try {
            // 1. Check Pipeline Status FIRST
            const statusResult = await getRecommendationsStatus(sessionId);
            if (!isMounted.current) return;

            // console.log("Pipeline Status Check Result:", statusResult.status);
            const currentStatus = statusResult.status;

            // 2. Decide action based on status
            if (currentStatus === PipelineStatus.PIPELINE_RUNNING ||
                currentStatus === PipelineStatus.SESSION_CREATED ||
                currentStatus === PipelineStatus.STARTED)
            {
                // If pipeline is running, fetch follow-up questions (fetchAndSetQuestions handles the isFetching flag)
                // console.log("Pipeline running, attempting to fetch questions...");
                await fetchAndSetQuestions();
            }
            else if (currentStatus === PipelineStatus.READY ||
                     currentStatus === PipelineStatus.ERROR ||
                     currentStatus === PipelineStatus.GENERATING_REPORT ||
                     currentStatus === PipelineStatus.NOT_FOUND)
            {
                // If pipeline is finished, errored, or moved to report generation, STOP polling and navigate
                console.log(`Pipeline status (${currentStatus}) indicates follow-up phase is over. Stopping poll and navigating...`);
                if (pollingIntervalRef.current) {
                    clearInterval(pollingIntervalRef.current);
                    pollingIntervalRef.current = null;
                }
                navigate('/recommendations');
            } else {
                console.warn(`Received unknown pipeline status: ${currentStatus}. Attempting to fetch questions anyway.`);
                await fetchAndSetQuestions();
            }

        } catch (pollError) {
            if (!isMounted.current) return;
            console.error('Error during polling cycle:', pollError);
            // setError("Polling error. Retrying..."); // Maybe show transient error
        } finally {
             // Set initial loading to false after the first poll completes (success or error)
             if (initialLoading && isMounted.current) {
                 setInitialLoading(false);
             }
        }
    }, [sessionId, navigate, fetchAndSetQuestions, initialLoading]); // Add initialLoading here

    // --- useEffect for Initial Load and Polling ---
    useEffect(() => {
        isMounted.current = true;

        if (!sessionId) {
            setError('No Session ID provided.');
            setInitialLoading(false);
            return;
        }

        setInitialLoading(true); // Set loading true on mount/sessionId change
        setError('');

        // Initial data fetch cycle
        pollData();

        // Start the single polling interval
        // console.log("Starting combined polling interval...");
        pollingIntervalRef.current = setInterval(pollData, 12000); // Poll every 12 seconds

        // Cleanup function
        return () => {
            isMounted.current = false;
            // console.log("Stopping polling (cleanup).");
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, [sessionId, pollData]); // pollData is memoized and should be stable


    // --- Answer Handlers (handleAnswerChange, handleMultiSelectChange, handleSubjectiveInputChange) ---
    // (No changes needed)
    const handleAnswerChange = (questionId, value) => {
        setAnswers((prev) => ({ ...prev, [questionId]: value }));
    };
    const handleMultiSelectChange = (questionId, selectedOptions) => {
         setAnswers((prev) => ({
             ...prev,
             [questionId]: { ...(prev[questionId] || { values: [], subjective_value: '' }), values: selectedOptions },
         }));
    };
    const handleSubjectiveInputChange = (questionId, value) => {
         const currentQuestion = followupQuestions.find((q) => q.question_id === questionId);
         if (!currentQuestion) return;
         const fields = currentQuestion.additional_fields || {};
         const multiOptions = fields.multiple_correct_answer_options || [];
         const subjectiveAnswerField = fields.subjective_answer || [];

         if (multiOptions.length > 0) {
             setAnswers((prev) => ({
                 ...prev,
                 [questionId]: { ...(prev[questionId] || { values: [], subjective_value: '' }), subjective_value: value },
             }));
         } else if (subjectiveAnswerField.length > 0) {
             handleAnswerChange(questionId, value);
         }
    };


    // --- Submit Handler (handleSubmit) ---
    // (No changes needed)
    const handleSubmit = async () => {
        setSubmitting(true);
        setError('');
        const payload = followupQuestions.map((q) => {
            const qId = q.question_id;
            const answerState = answers[qId];
            let answerPayload = {};
            const fields = q.additional_fields || {};
            const multiOptions = fields.multiple_correct_answer_options || [];
            const subjectiveAnswerField = fields.subjective_answer || [];

            if (multiOptions.length > 0) {
                const currentValues = answerState?.values || [];
                const currentSubjective = answerState?.subjective_value || '';
                if (currentValues.length > 0 || currentSubjective.trim() !== '') {
                    answerPayload = { values: currentValues, subjective_value: currentSubjective.trim() };
                } else if (multiOptions.includes('') && multiOptions.length === 1) {
                     answerPayload = { values: [], subjective_value: "" };
                }
            } else if (subjectiveAnswerField.length > 0) {
                if (typeof answerState === 'string' && answerState.trim() !== '') {
                    answerPayload = { value: answerState.trim() };
                } else {
                     answerPayload = { value: '' };
                }
            } else { // Single-select dropdown
                if (typeof answerState === 'string' && answerState !== '') {
                    answerPayload = { value: answerState };
                }
            }
            if (answerPayload === null || answerPayload === undefined) {
                 answerPayload = {};
            }
            return {
                session_id: sessionId,
                question_id: qId,
                question: q.question,
                category: q.category,
                subcategory: q.subcategory,
                answer: answerPayload,
            };
        });

        const filteredPayload = payload.filter((item) => Object.keys(item.answer).length > 0);
        if (filteredPayload.length === 0) {
            alert('Please answer at least one question before submitting.');
            setSubmitting(false);
            return;
        }
        console.log('Submitting Payload:', JSON.stringify(filteredPayload, null, 2));
        try {
            await submitFollowupResponses(filteredPayload);
            alert('Answers submitted successfully.');
            // Clear the displayed questions immediately after successful submission
            // The next poll will likely confirm they are gone anyway.
            setFollowupQuestions([]);
            setAnswers({}); // Clear answers as well
        } catch (submitError) {
            console.error('Error submitting follow-up responses:', submitError);
            const errorMsg = submitError.response?.data?.detail || submitError.message || 'Unknown error';
            setError(`Submission failed: ${errorMsg}. Please try again.`);
            alert(`Submission failed: ${errorMsg}`);
        } finally {
            if (isMounted.current) {
                 setSubmitting(false);
            }
        }
    };

    // --- Render Input Logic (renderQuestionInput) ---
    // (No changes needed)
    const renderQuestionInput = (q) => {
        const qId = q.question_id;
        const fields = q.additional_fields || {};
        const answerOptions = fields.answer_options || [];
        const subjectiveAnswerField = fields.subjective_answer || [];
        const multiOptions = fields.multiple_correct_answer_options || [];
        const hasSubjectiveInMulti = multiOptions.includes('');

        if (multiOptions.length > 0) {
            const currentAnswerState = answers[qId] || { values: [], subjective_value: '' };
            const currentSelections = currentAnswerState.values || [];
            return (
                <div className="multi-select-options">
                    <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>Select all that apply:</p>
                    {multiOptions.filter(opt => opt !== '').map((option, index) => (
                        <div key={index} className="checkbox-option" style={{ marginBottom: '5px' }}>
                            <input type="checkbox" id={`${qId}-${index}`} value={option} checked={currentSelections.includes(option)}
                                onChange={(e) => {
                                    const { value, checked } = e.target;
                                    const newSelected = checked ? [...currentSelections, value] : currentSelections.filter(v => v !== value);
                                    handleMultiSelectChange(qId, newSelected);
                                }} style={{ marginRight: '8px', cursor: 'pointer' }} />
                            <label htmlFor={`${qId}-${index}`} style={{ cursor: 'pointer' }}>{option}</label>
                        </div>
                    ))}
                    {hasSubjectiveInMulti && (
                        <div className="subjective-input" style={{ marginTop: '10px' }}>
                            <label htmlFor={`${qId}-subjective`} style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Other (please specify):</label>
                            <textarea id={`${qId}-subjective`} placeholder="Provide details here..."
                                value={currentAnswerState.subjective_value || ''}
                                onChange={(e) => handleSubjectiveInputChange(qId, e.target.value)}
                                rows={3} style={{ width: '95%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                        </div>
                    )}
                </div>
            );
        } else if (answerOptions.length > 0) {
            return (
                <select value={answers[qId] || ''} onChange={(e) => handleAnswerChange(qId, e.target.value)}
                    className="single-select" style={{ padding: '10px 8px', minWidth: '250px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', boxSizing: 'border-box' }}>
                    <option value="" disabled>-- Select an option --</option>
                    {answerOptions.map((option, index) => (<option key={index} value={option}>{option}</option>))}
                </select>
            );
        } else if (subjectiveAnswerField.length > 0) {
            return (
                <textarea value={answers[qId] || ''} onChange={(e) => handleAnswerChange(qId, e.target.value)}
                    placeholder="Your answer..." className="subjective-textarea" rows={4}
                    style={{ width: '95%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
            );
        } else {
            return <p><i>(No input options defined for this question type)</i></p>;
        }
    };


    // --- Main Return Logic ---

    if (!sessionId) {
        return (
            <div className="error-message" style={{ color: 'red', padding: '20px', border: '1px solid red', margin: '20px', borderRadius: '5px', textAlign: 'center' }}>
                Error: No session ID found. Please start the process over.
            </div>
        );
    }

    if (initialLoading) { // Show loading only on initial mount
        return (
            <div className="loading-screen" style={{ padding: '40px 20px', textAlign: 'center', color: '#555' }}>
                <h2>Checking for follow-up questions...</h2>
                <p>Please wait.</p>
                <div style={{ marginTop: '20px', height: '30px' }}><span>Loading...</span></div>
            </div>
        );
    }

    // Main render: Display questions or a waiting message
    return (
        <div className="followup-questions-container" style={{ padding: '20px', maxWidth: '800px', margin: '20px auto', fontFamily: 'Arial, sans-serif', border: '1px solid #e0e0e0', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', background: '#fff' }}>
            <h1 style={{ textAlign: 'center', marginBottom: '25px', color: '#333' }}>
                Follow-Up Questions
            </h1>

            {error && (
                <p className="error-message" style={{ color: 'red', border: '1px solid red', padding: '10px 15px', marginBottom: '20px', borderRadius: '4px', background: '#ffebee' }}>
                    {error}
                </p>
            )}

            {/* Show questions ONLY if the list is not empty */}
            {followupQuestions.length > 0 ? (
                <>
                    <p style={{ marginBottom: '20px', color: '#555' }}>
                        Please answer the following questions to help refine the assessment.
                        {isFetchingQuestions && <span style={{marginLeft: '10px', fontStyle: 'italic'}}>(Checking for updates...)</span>} {/* Subtle fetch indicator */}
                    </p>
                    <div className="questions-list">
                        {followupQuestions.map((q) => (
                            <div key={q.question_id} className="question-card" style={{ border: '1px solid #ddd', padding: '20px', marginBottom: '20px', borderRadius: '5px', background: '#f9f9f9', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                                <h3 style={{ marginTop: '0', marginBottom: '10px', color: '#444', fontSize: '1.1em' }}>
                                    {q.question}
                                </h3>
                                {q.additional_fields?.guidelines && (
                                    <p className="guidelines" style={{ fontSize: '0.9em', color: '#666', margin: '0 0 15px 0', fontStyle: 'italic', borderLeft: '3px solid #007bff', padding: '8px 10px', background: '#e7f3ff', borderRadius: '3px' }}>
                                        <strong>Guidelines:</strong> {q.additional_fields.guidelines}
                                    </p>
                                )}
                                <div className="input-area" style={{ marginTop: '15px' }}>
                                    {renderQuestionInput(q)}
                                </div>
                            </div>
                        ))}
                    </div>
                    <button onClick={handleSubmit} disabled={submitting}
                        style={{ marginTop: '10px', padding: '12px 25px', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: '1.05em', backgroundColor: submitting ? '#ccc' : '#007bff', color: 'white', border: 'none', borderRadius: '5px', opacity: submitting ? 0.7 : 1, display: 'block', width: '100%', boxSizing: 'border-box' }}>
                        {submitting ? 'Submitting...' : 'Submit Answers'}
                    </button>
                </>
            ) : (
                /* Display message when no questions are available */
                <div className="no-questions-message" style={{ padding: '30px 20px', textAlign: 'center', color: '#555', background: '#f0f0f0', borderRadius: '5px' }}>
                     <>
                         <h2>No follow-up questions available at this moment.</h2>
                         <p>
                             {isFetchingQuestions
                               ? "Checking for updates..."
                               : "Waiting for the assessment process to complete..."}
                         </p>
                         {/* Optional: Add a spinner when isFetchingQuestions is true */}
                         {isFetchingQuestions && <div style={{marginTop: '10px'}}><span>Loading...</span></div>}
                     </>
                </div>
            )}
        </div>
    );
};

export default FollowupQuestions;
