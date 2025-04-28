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

const POLLING_INTERVAL_MS = 12000; // Set polling interval (e.g., 12 seconds)

const FollowupQuestions = ({ sessionId }) => {
    // --- States ---
    const [followupQuestions, setFollowupQuestions] = useState([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [answers, setAnswers] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    // --- Hooks and Refs ---
    const navigate = useNavigate();
    const timeoutRef = useRef(null); // Ref to store the setTimeout ID
    const isMounted = useRef(true); // Track mount status

    // --- Fetch Follow-up Questions (Stable - only depends on sessionId) ---
    // This function is now simpler as it doesn't need to manage fetching state itself
    const fetchAndSetQuestions = useCallback(async () => {
        if (!isMounted.current) return;
        // console.log("Fetching followup questions...");

        try {
            const data = await getFollowupQuestions(sessionId);
            if (!isMounted.current) return;

            if (data === null || data === undefined) {
                console.warn("API returned null/undefined followup data.");
                 // Decide if null/undefined should clear questions
                 setFollowupQuestions(current => current.length === 0 ? current : []); // Clear only if not already empty
            } else {
                // Update questions and initialize answers for new ones
                setFollowupQuestions(currentQuestions => {
                    const currentIds = currentQuestions.map(q => q.question_id).sort().join(',');
                    const newIds = data.map(q => q.question_id).sort().join(',');

                    if (currentIds !== newIds) {
                        console.log("New questions detected, updating state.");
                        setAnswers((prevAnswers) => {
                            const newAnswers = { ...prevAnswers };
                            data.forEach((q) => {
                                if (!(q.question_id in newAnswers)) {
                                    const fields = q.additional_fields || {};
                                    const multiOptions = fields.multiple_correct_answer_options || [];
                                    newAnswers[q.question_id] = multiOptions.length > 0
                                        ? { values: [], subjective_value: '' }
                                        : '';
                                }
                            });
                            return newAnswers;
                        });
                        return data; // Update the questions list
                    }
                    return currentQuestions; // No change
                });
            }
        } catch (fetchError) {
            if (!isMounted.current) return;
            console.error('Error retrieving follow-up questions:', fetchError);
            // setError("Could not fetch questions."); // Set transient error maybe?
        }
    }, [sessionId]); // Dependency is stable

    // --- Polling Function (Recursive setTimeout) ---
    const pollData = useCallback(async () => {
        if (!isMounted.current || !sessionId) return; // Stop if unmounted or no session ID

        // console.log("Polling cycle initiated...");
        let shouldStopPolling = false; // Flag to prevent scheduling next poll if navigating

        try {
            // 1. Check Pipeline Status FIRST
            const statusResult = await getRecommendationsStatus(sessionId);
            if (!isMounted.current) return; // Check mount status after await

            // console.log("Pipeline Status Check Result:", statusResult.status);
            const currentStatus = statusResult.status;

            // 2. Decide action based on status
            if (currentStatus === PipelineStatus.PIPELINE_RUNNING ||
                currentStatus === PipelineStatus.SESSION_CREATED ||
                currentStatus === PipelineStatus.STARTED)
            {
                // If pipeline is running, fetch follow-up questions
                // console.log("Pipeline running, fetching questions...");
                await fetchAndSetQuestions();
            }
            else if (currentStatus === PipelineStatus.READY ||
                     currentStatus === PipelineStatus.ERROR ||
                     currentStatus === PipelineStatus.GENERATING_REPORT ||
                     currentStatus === PipelineStatus.NOT_FOUND)
            {
                // If pipeline is finished, errored, or moved to report generation, STOP polling and navigate
                console.log(`Pipeline status (${currentStatus}) indicates follow-up phase is over. Navigating...`);
                shouldStopPolling = true; // Set flag to stop
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
            if (isMounted.current) {
                 // Set initial loading to false after the first poll completes
                 if (initialLoading) {
                    setInitialLoading(false);
                 }
                 // Schedule the next poll *only if* we haven't decided to stop
                 if (!shouldStopPolling) {
                    // console.log(`Scheduling next poll in ${POLLING_INTERVAL_MS}ms`);
                    timeoutRef.current = setTimeout(pollData, POLLING_INTERVAL_MS);
                 }
             }
        }
    }, [sessionId, navigate, fetchAndSetQuestions, initialLoading]); // Dependencies


    // --- useEffect for Initial Load and Starting Polling ---
    useEffect(() => {
        isMounted.current = true;

        if (!sessionId) {
            setError('No Session ID provided.');
            setInitialLoading(false);
            return;
        }

        setInitialLoading(true);
        setError('');
        setFollowupQuestions([]); // Clear questions on mount/sessionId change
        setAnswers({}); // Clear answers

        // Start the first polling cycle
        pollData();

        // Cleanup function: Clear timeout on unmount
        return () => {
            isMounted.current = false;
            console.log("Clearing polling timeout (cleanup).");
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
        // Effect runs when sessionId changes or pollData reference changes (which depends on fetchAndSetQuestions)
    }, [sessionId, pollData]); // Keep pollData dependency


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
    // (No changes needed, but added clearing timeout temporarily)
    const handleSubmit = async () => {
        // Temporarily clear polling during submission to avoid conflicts
        if (timeoutRef.current) {
             clearTimeout(timeoutRef.current);
             timeoutRef.current = null;
        }

        setSubmitting(true);
        setError('');
        // --- (rest of existing submit logic) ---
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
             // Restart polling if submission is cancelled
            if (isMounted.current) {
                 timeoutRef.current = setTimeout(pollData, POLLING_INTERVAL_MS);
            }
            return;
        }
        console.log('Submitting Payload:', JSON.stringify(filteredPayload, null, 2));
        // --- (rest of existing submit logic) ---
        try {
            await submitFollowupResponses(filteredPayload);
            alert('Answers submitted successfully.');
            setFollowupQuestions([]);
            setAnswers({});
        } catch (submitError) {
            console.error('Error submitting follow-up responses:', submitError);
            const errorMsg = submitError.response?.data?.detail || submitError.message || 'Unknown error';
            setError(`Submission failed: ${errorMsg}. Please try again.`);
            alert(`Submission failed: ${errorMsg}`);
        } finally {
            if (isMounted.current) {
                 setSubmitting(false);
                 // Restart polling after submission attempt completes (success or error)
                 // console.log("Restarting polling after submission attempt.");
                 timeoutRef.current = setTimeout(pollData, POLLING_INTERVAL_MS);
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
        return ( <div className="error-message" style={{ color: 'red', padding: '20px', border: '1px solid red', margin: '20px', borderRadius: '5px', textAlign: 'center' }}>Error: No session ID found. Please start the process over.</div> );
    }

    if (initialLoading) {
        return ( <div className="loading-screen" style={{ padding: '40px 20px', textAlign: 'center', color: '#555' }}><h2>Checking for follow-up questions...</h2><p>Please wait.</p><div style={{ marginTop: '20px', height: '30px' }}><span>Loading...</span></div></div> );
    }

    return (
        <div className="followup-questions-container" style={{ padding: '20px', maxWidth: '800px', margin: '20px auto', fontFamily: 'Arial, sans-serif', border: '1px solid #e0e0e0', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', background: '#fff' }}>
            <h1 style={{ textAlign: 'center', marginBottom: '25px', color: '#333' }}>Follow-Up Questions</h1>

            {error && ( <p className="error-message" style={{ color: 'red', border: '1px solid red', padding: '10px 15px', marginBottom: '20px', borderRadius: '4px', background: '#ffebee' }}>{error}</p> )}

            {followupQuestions.length > 0 ? (
                <>
                    <p style={{ marginBottom: '20px', color: '#555' }}>Please answer the following questions to help refine the assessment.</p>
                    <div className="questions-list">
                        {followupQuestions.map((q) => (
                            <div key={q.question_id} className="question-card" style={{ border: '1px solid #ddd', padding: '20px', marginBottom: '20px', borderRadius: '5px', background: '#f9f9f9', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                                <h3 style={{ marginTop: '0', marginBottom: '10px', color: '#444', fontSize: '1.1em' }}>{q.question}</h3>
                                {q.additional_fields?.guidelines && ( <p className="guidelines" style={{ fontSize: '0.9em', color: '#666', margin: '0 0 15px 0', fontStyle: 'italic', borderLeft: '3px solid #007bff', padding: '8px 10px', background: '#e7f3ff', borderRadius: '3px' }}><strong>Guidelines:</strong> {q.additional_fields.guidelines}</p> )}
                                <div className="input-area" style={{ marginTop: '15px' }}>{renderQuestionInput(q)}</div>
                            </div>
                        ))}
                    </div>
                    <button onClick={handleSubmit} disabled={submitting} style={{ marginTop: '10px', padding: '12px 25px', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: '1.05em', backgroundColor: submitting ? '#ccc' : '#007bff', color: 'white', border: 'none', borderRadius: '5px', opacity: submitting ? 0.7 : 1, display: 'block', width: '100%', boxSizing: 'border-box' }}>
                        {submitting ? 'Submitting...' : 'Submit Answers'}
                    </button>
                </>
            ) : (
                <div className="no-questions-message" style={{ padding: '30px 20px', textAlign: 'center', color: '#555', background: '#f0f0f0', borderRadius: '5px' }}>
                     <>
                         <h2>No follow-up questions available at this moment.</h2>
                         <p>Checking for updates or waiting for the process to complete...</p>
                         {/* You could add a spinner here */}
                         {/* <div style={{marginTop: '10px'}}><span>Loading...</span></div> */}
                     </>
                </div>
            )}
        </div>
    );
};

export default FollowupQuestions;
