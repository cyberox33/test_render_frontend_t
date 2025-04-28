import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getFollowupQuestions,
    submitFollowupResponses,
    getRecommendationsStatus // Import the status check API call
} from '../services/api';

// Define the possible statuses from the backend's /recommendations/status endpoint
const PipelineStatus = {
    PIPELINE_RUNNING: 'pipeline_running', // New status: RAG is active
    GENERATING_REPORT: 'generating_report', // Report generation started/active
    READY: 'ready', // Report is complete and URL available
    ERROR: 'error', // An error occurred
    NOT_FOUND: 'not_found' // Session ID invalid or not found
};


const FollowupQuestions = ({ sessionId }) => {
    // --- Existing States ---
    const [followupQuestions, setFollowupQuestions] = useState([]);
    const [loading, setLoading] = useState(true); // For initial question load
    const [answers, setAnswers] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(''); // For user-facing errors (submission, fetch)
    const [pipelineState, setPipelineState] = useState(PipelineStatus.PIPELINE_RUNNING); // Track overall state, default to running

    // --- Hooks and Refs ---
    const navigate = useNavigate();
    const followupIntervalRef = useRef(null);
    const statusCheckIntervalRef = useRef(null); // Ref for the status polling interval
    const isMounted = useRef(true); // Track if component is mounted to prevent state updates after unmount

    // --- Fetch Follow-up Questions ---
    const fetchAndSetQuestions = useCallback(async () => {
        // Only fetch if the pipeline is potentially running and component is mounted
        if (!isMounted.current || pipelineState !== PipelineStatus.PIPELINE_RUNNING) {
            // console.log("Skipping followup fetch: Component unmounted or pipeline not running.");
            return;
        }
        // console.log("Polling for followup questions..."); // Keep commented unless debugging needed
        // Don't clear general error here, only fetch-specific errors if needed
        // setError('');

        try {
            const data = await getFollowupQuestions(sessionId);
            if (!isMounted.current) return; // Check again after await

            if (data === null || data === undefined) {
                console.warn("API returned null/undefined followup data.");
                // Don't set a major error, just log, maybe backend is done? Status check will handle it.
            } else {
                setFollowupQuestions(data); // Update state with current questions

                // Initialize answers state only for *newly* arrived questions
                setAnswers((prev) => {
                    const newAnswers = { ...prev };
                    let needsUpdate = false;
                    data.forEach((q) => {
                        if (!(q.question_id in newAnswers)) {
                            needsUpdate = true;
                            const fields = q.additional_fields || {};
                            const multiOptions = fields.multiple_correct_answer_options || [];
                            if (multiOptions.length > 0) {
                                newAnswers[q.question_id] = { values: [], subjective_value: '' };
                            } else {
                                newAnswers[q.question_id] = '';
                            }
                        }
                    });
                    return needsUpdate ? newAnswers : prev;
                });
            }
            // Set loading false *only after the very first successful fetch*
            if (loading) setLoading(false);

        } catch (fetchError) {
            if (!isMounted.current) return;
            console.error('Error retrieving follow-up questions:', fetchError);
            // Don't set a persistent error here, status check handles final state
            // setError('Failed to load questions. Retrying in background...');
            if (loading) setLoading(false); // Ensure loading stops even on initial error
        }
    }, [sessionId, pipelineState, loading]); // Depend on pipelineState and loading

    // --- Check Overall Pipeline Status ---
    const checkPipelineStatus = useCallback(async () => {
        if (!isMounted.current || !sessionId) return; // Stop if unmounted or no session ID

        // console.log("Polling for overall pipeline status..."); // Debug log
        try {
            const result = await getRecommendationsStatus(sessionId);
            if (!isMounted.current) return; // Check again after await

            console.log("Pipeline Status Check Result:", result.status); // Log the received status
            setPipelineState(result.status); // Update the tracked pipeline state

            // --- Navigation Logic ---
            // Navigate if the pipeline is definitively finished or errored
            if (result.status === PipelineStatus.READY ||
                result.status === PipelineStatus.ERROR ||
                result.status === PipelineStatus.GENERATING_REPORT || // Navigate as soon report gen starts
                result.status === PipelineStatus.NOT_FOUND) // Also navigate on not_found
            {
                console.log(`Pipeline status (${result.status}) indicates follow-up phase is over. Navigating...`);

                // Clear intervals BEFORE navigating
                if (followupIntervalRef.current) clearInterval(followupIntervalRef.current);
                if (statusCheckIntervalRef.current) clearInterval(statusCheckIntervalRef.current);
                followupIntervalRef.current = null;
                statusCheckIntervalRef.current = null;

                navigate('/recommendations'); // Navigate to recommendations page
            }
            // No else needed: If status is PIPELINE_RUNNING, polling continues

        } catch (statusError) {
            if (!isMounted.current) return;
            console.error('Error checking pipeline status:', statusError);
            // If status check fails repeatedly, maybe set an error state?
            // For now, just log it. The next poll might succeed.
            // setError("Could not check assessment status. Retrying...");
        }
    }, [sessionId, navigate]); // Dependencies

    // --- useEffect for Polling ---
    useEffect(() => {
        isMounted.current = true; // Set mounted state on mount

        if (!sessionId) {
            setError('No Session ID provided.');
            setLoading(false);
            setPipelineState(PipelineStatus.ERROR); // Set error state if no session ID
            return; // Stop if no session ID
        }

        setLoading(true); // Start loading
        setError(''); // Clear previous errors
        setPipelineState(PipelineStatus.PIPELINE_RUNNING); // Assume running initially

        // Initial fetches
        fetchAndSetQuestions();
        checkPipelineStatus();

        // Start polling intervals
        // console.log("Starting polling intervals...");
        followupIntervalRef.current = setInterval(fetchAndSetQuestions, 10000); // Poll questions (will self-limit based on pipelineState)
        statusCheckIntervalRef.current = setInterval(checkPipelineStatus, 12000); // Poll status (will trigger navigation)

        // Cleanup function
        return () => {
            isMounted.current = false; // Set unmounted state on cleanup
            // console.log("Stopping polling (cleanup).");
            if (followupIntervalRef.current) clearInterval(followupIntervalRef.current);
            if (statusCheckIntervalRef.current) clearInterval(statusCheckIntervalRef.current);
        };
        // Only depend on sessionId, fetchAndSetQuestions, checkPipelineStatus
    }, [sessionId, fetchAndSetQuestions, checkPipelineStatus]);


    // --- Answer Handlers (handleAnswerChange, handleMultiSelectChange, handleSubjectiveInputChange) ---
    // (Keep existing implementations - No changes needed here)
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
    // (Keep existing implementation - No changes needed here)
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
            // Let polling handle fetching updated questions (likely empty now)
            // Optionally clear local answers: setAnswers({});
        } catch (submitError) {
            console.error('Error submitting follow-up responses:', submitError);
            const errorMsg = submitError.response?.data?.detail || submitError.message || 'Unknown error';
            setError(`Submission failed: ${errorMsg}. Please try again.`);
            alert(`Submission failed: ${errorMsg}`);
        } finally {
            if (isMounted.current) { // Check if mounted before setting state
                 setSubmitting(false);
            }
        }
    };

    // --- Render Input Logic (renderQuestionInput) ---
    // (Keep existing implementation - No changes needed here)
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

    // Show error if session ID was missing initially
    if (!sessionId) {
        return (
            <div className="error-message" style={{ color: 'red', padding: '20px', border: '1px solid red', margin: '20px', borderRadius: '5px', textAlign: 'center' }}>
                Error: No session ID found. Please start the process over.
            </div>
        );
    }

    // Show loading indicator only during the very initial phase
    if (loading) {
        return (
            <div className="loading-screen" style={{ padding: '40px 20px', textAlign: 'center', color: '#555' }}>
                <h2>Checking for follow-up questions...</h2>
                <p>Please wait.</p>
                <div style={{ marginTop: '20px', height: '30px' }}><span>Loading...</span></div>
            </div>
        );
    }

    // Main render: Display questions or a waiting message based on state
    return (
        <div className="followup-questions-container" style={{ padding: '20px', maxWidth: '800px', margin: '20px auto', fontFamily: 'Arial, sans-serif', border: '1px solid #e0e0e0', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', background: '#fff' }}>
            <h1 style={{ textAlign: 'center', marginBottom: '25px', color: '#333' }}>
                Follow-Up Questions
            </h1>

            {/* Display persistent errors (e.g., submission errors) */}
            {error && (
                <p className="error-message" style={{ color: 'red', border: '1px solid red', padding: '10px 15px', marginBottom: '20px', borderRadius: '4px', background: '#ffebee' }}>
                    {error}
                </p>
            )}

            {/* Show questions if available AND pipeline is still running */}
            {pipelineState === PipelineStatus.PIPELINE_RUNNING && followupQuestions.length > 0 ? (
                <>
                    <p style={{ marginBottom: '20px', color: '#555' }}>
                        Please answer the following questions to help refine the assessment.
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
                    {/* Submit Button */}
                    <button onClick={handleSubmit} disabled={submitting}
                        style={{ marginTop: '10px', padding: '12px 25px', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: '1.05em', backgroundColor: submitting ? '#ccc' : '#007bff', color: 'white', border: 'none', borderRadius: '5px', opacity: submitting ? 0.7 : 1, display: 'block', width: '100%', boxSizing: 'border-box' }}>
                        {submitting ? 'Submitting...' : 'Submit Answers'}
                    </button>
                </>
            ) : (
                /* Display message when no questions are available OR pipeline is past running state */
                <div className="no-questions-message" style={{ padding: '30px 20px', textAlign: 'center', color: '#555', background: '#f0f0f0', borderRadius: '5px' }}>
                    {pipelineState === PipelineStatus.PIPELINE_RUNNING ? (
                        <> {/* Use Fragment here */}
                            <h2>No follow-up questions available at this moment.</h2>
                            <p>Checking for updates or waiting for the next step...</p>
                        </>
                    ) : (
                         // --- FIX START ---
                         // Wrap adjacent elements in a Fragment
                         <>
                             {/* This message shows briefly before navigation happens */}
                             <h2>Processing complete or report is generating.</h2>
                             <p>Redirecting to the recommendations page shortly...</p>
                         </>
                         // --- FIX END ---
                    )}
                     {/* Remove the manual navigation button as it's automatic now */}
                </div>
            )}
        </div>
    );
};

export default FollowupQuestions;
