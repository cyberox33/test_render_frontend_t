import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getSurveyQuestions,
    submitSurveyResponses,
    getCurrentUser // Used for validation
} from '../services/api'; // Ensure api.js path is correct
import SurveyQuestion from '../components/SurveyQuestion'; // Ensure path is correct
import AuthForm from '../components/AuthForm'; // Ensure path is correct
import styles from './SurveyPage.module.css'; // Ensure path is correct

// Define possible status states
const AuthStatus = {
    IDLE: 'IDLE', // Initial state before validation starts
    VALIDATING: 'VALIDATING', // Checking existing token
    AUTHENTICATED: 'AUTHENTICATED', // Validation succeeded or login successful
    UNAUTHENTICATED: 'UNAUTHENTICATED', // No valid token, show login
    FAILED: 'FAILED', // An error occurred during validation/fetch
};

const SurveyPage = () => {
    // --- State Definitions ---
    const [questions, setQuestions] = useState([]);
    const [loadingQuestions, setLoadingQuestions] = useState(false); // For loading questions *after* auth
    const [submitting, setSubmitting] = useState(false); // For survey submission
    const [authStatus, setAuthStatus] = useState(AuthStatus.IDLE); // Master status
    const [responses, setResponses] = useState({}); // Survey answers
    // State to display non-critical errors within the page
    const [pageError, setPageError] = useState(null);
    const navigate = useNavigate();

    // --- Centralized Logout Handler ---
    // Stable function reference due to useCallback with empty dependency array
    const handleLogout = useCallback((isSilent = false) => {
        if (!isSilent) console.log("handleLogout: Explicit logout.");
        else console.log("handleLogout: Silent logout (validation or other failure).");
        // --- Use sessionStorage ---
        sessionStorage.removeItem("access_token");
        sessionStorage.removeItem("session_id");
        setAuthStatus(AuthStatus.UNAUTHENTICATED); // Set status directly
        setQuestions([]); // Clear data
        setResponses({});
        setLoadingQuestions(false);
        setSubmitting(false);
        setPageError(null); // Clear page errors on logout
    }, []); // Empty array: This function's reference is stable

    // --- Fetch Questions Function (called AFTER authentication is confirmed) ---
    // Stable function reference assuming dependencies (setters, imported APIs, handleLogout) are stable
    const fetchQuestions = useCallback(async () => {
        console.log("fetchQuestions: Attempting to fetch (authentication confirmed).");
        setLoadingQuestions(true);
        setPageError(null); // Clear previous errors on new fetch
        setQuestions([]);
        setResponses({});
        try {
            const data = await getSurveyQuestions();
            console.log("fetchQuestions: Success.");
            setQuestions(data);
             if (!data || data.length === 0) {
                 console.warn("fetchQuestions: API returned successfully but no questions found.");
                 setPageError("No survey questions are currently available."); // Inform user
            }
        } catch (error) {
            console.error("fetchQuestions: Error fetching post-validation:", error);
            // Error handling depends on whether the interceptor handles 401s globally
            if (error.response?.status !== 401) {
                 setPageError("Failed to load survey questions. Please try refreshing the page.");
            } else {
                // If 401 occurs here, token might have expired *after* validation
                setPageError("Your session may have expired. Please log in again.");
                // Interceptor likely handles logout, but ensure state is UNAUTHENTICATED if needed
                 setAuthStatus(AuthStatus.UNAUTHENTICATED); // Force status if interceptor doesn't redirect/reload
            }
        } finally {
            setLoadingQuestions(false);
        }
    }, [handleLogout]); // Include stable handleLogout dependency (or empty array if eslint allows)

    // --- Function to Validate Session on Load ---
     // Stable function reference assuming dependencies (imported APIs, handleLogout, fetchQuestions) are stable
    const validateSessionAndFetch = useCallback(async () => {
        setAuthStatus(AuthStatus.VALIDATING);
        setPageError(null); // Clear error on validation start
        // --- Use sessionStorage ---
        const token = sessionStorage.getItem("access_token");

        if (!token) {
            console.log("validateSession: No access token found.");
            handleLogout(true); // Silently sets state to UNAUTHENTICATED
            return;
        }

        console.log("validateSession: Token found, attempting validation via getCurrentUser...");
        try {
            await getCurrentUser(); // Uses token via interceptor
            console.log("validateSession: Validation successful.");

            // --- Check session_id existence using sessionStorage ---
            const sessionId = sessionStorage.getItem("session_id");
            if (!sessionId) {
                console.error("validateSession: Validation successful but session_id missing! Logging out.");
                setPageError("Your session data is incomplete. Please log in again.");
                handleLogout(true);
                return;
             }

            setAuthStatus(AuthStatus.AUTHENTICATED); // Set authenticated status
            fetchQuestions(); // Fetch questions now that validation passed

        } catch (error) {
            // Interceptor might handle 401 globally. If not, or for other errors:
            console.error("validateSession: Validation failed.", error);
            if (error.response?.status !== 401) {
                 setPageError("Could not verify your session due to a network or server error. Please try logging in.");
            } else {
                 console.log("validateSession: Authentication error during validation (token invalid/expired).");
                 // No specific error needed if AuthForm will be shown
            }
             handleLogout(true); // Logout silently on any validation failure
        }
    // }, [handleLogout, fetchQuestions]); // Old dependencies
     }, [handleLogout, fetchQuestions]); // Corrected: Include stable refs for clarity

    // --- Effect for Initial Validation on Mount ---
    useEffect(() => {
        // Call the validation function defined above
        validateSessionAndFetch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [validateSessionAndFetch]); // Rerun if validateSessionAndFetch changes (it shouldn't)

    // --- Handler for Successful Authentication via AuthForm ---
    // Depends on fetchQuestions (which is stable)
    const handleAuthSuccess = useCallback(() => {
        console.log("handleAuthSuccess: Login/Registration successful.");
        setAuthStatus(AuthStatus.AUTHENTICATED); // Set authenticated status
        setPageError(null); // Clear any previous page errors
        fetchQuestions(); // Fetch questions immediately
    }, [fetchQuestions]); // Correct: Depends on fetchQuestions

    // --- Response Change Handler ---
     // Stable function reference (only uses stable state setters)
    const handleResponseChange = useCallback((questionId, value) => {
         setPageError(null); // Clear error when user interacts
         setResponses(prev => ({ ...prev, [questionId]: value }));
     }, []); // Corrected: Empty array

    // --- Submit Handler ---
    const handleSubmit = useCallback(async () => {
        const sessionId = sessionStorage.getItem("session_id");
        if (!sessionId || authStatus !== AuthStatus.AUTHENTICATED) {
            setPageError("Your session is invalid or has expired. Please log in again.");
            handleLogout();
            return;
        }
    
        const unansweredQuestions = questions.filter(q => responses[q.question_id] === undefined || responses[q.question_id] === '');
        if (unansweredQuestions.length > 0) {
            setPageError(`Please answer all questions.`);
            return;
        }
    
        setSubmitting(true);
        setPageError(null);
    
        const responsePayload = {
            session_id: sessionId,
            responses: Object.keys(responses).map(qid => ({
                // --- REMOVE parseInt ---
                question_id: qid, // Keep the original string key "Q1", "Q2", etc.
                // --- END REMOVE parseInt ---
                answer: responses[qid]
            }))
        };
    
        // Add this log to verify before sending
        console.log("Submitting CORRECTED survey payload:", JSON.stringify(responsePayload, null, 2));
    
        try {
            await submitSurveyResponses(responsePayload);
            console.log("Survey submitted successfully!");
            setPageError(null);
            navigate("/followup");
        } catch (error) {
             console.error("Error submitting survey responses:", error);
            if (error.response?.status !== 401) {
                setPageError(`Submission failed: ${error.response?.data?.detail || 'Please try again.'}`);
            } else if (authStatus !== AuthStatus.UNAUTHENTICATED) {
                 setPageError("Your session expired during submission. Please log in again.");
                 setAuthStatus(AuthStatus.UNAUTHENTICATED);
            }
        } finally {
            setSubmitting(false);
        }
    }, [authStatus, questions, responses, navigate, handleLogout]);

    // --- Effect to manage body class for background ---
    useEffect(() => {
        const surveyBodyClass = 'survey-active-background'; // Class name for survey background

        if (authStatus === AuthStatus.AUTHENTICATED) {
            // Add class when authenticated and showing survey
            document.body.classList.add(surveyBodyClass);
        } else {
            // Remove class when not authenticated or validating
            document.body.classList.remove(surveyBodyClass);
        }

        // Cleanup function: Remove class when component unmounts
        return () => {
            document.body.classList.remove(surveyBodyClass);
        };
    }, [authStatus]); // Re-run this effect when authStatus changes


    // --- Render Logic based on authStatus ---

    switch (authStatus) {
        case AuthStatus.IDLE:
        case AuthStatus.VALIDATING:
            console.log(`Rendering: Status=${authStatus}`);
            // Show a loading indicator while checking the session
            return <div className={styles.loadingMessage}>Initializing...</div>;

        case AuthStatus.UNAUTHENTICATED:
        case AuthStatus.FAILED:
             console.log(`Rendering: Status=${authStatus} -> AuthForm`);
            // Display pageError if it was set before logout/failure led here
            return (
                <div>
                    {/* Display persistent errors above AuthForm if needed */}
                    {pageError && <p className={styles.errorMessage} style={{textAlign: 'center', marginTop: '20px', color: '#D32F2F'}}>{pageError}</p>}
                    <AuthForm onAuthSuccess={handleAuthSuccess} />
                </div>
            );


        case AuthStatus.AUTHENTICATED:
            console.log(`Rendering: Status=${authStatus}`);
            // --- Main Authenticated View ---
            // This div uses styles from SurveyPage.module.css
            // The body background is handled by the useEffect hook above
            return (
                <div className={styles.surveyContainer}>
                    {/* Display Non-Critical Errors at the top */}
                    {pageError && <p className={styles.errorMessage}>{pageError}</p>}

                    {loadingQuestions ? (
                        <div className={styles.loadingMessage}>Loading survey questions...</div>
                    ) : ( // Render survey content or "no questions" message
                        <>
                            <h1>Survey</h1>
                            {questions.length === 0 && !pageError ? ( // Show only if fetch finished and returned none, and no other error shown
                                <p className={styles.loadingMessage}>No survey questions are currently available.</p>
                            ) : questions.length > 0 ? (
                                // --- Render Survey Form only if questions exist ---
                                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                                    {questions.map((q) => (
                                        <div key={q.question_id} className={styles.questionBlock} data-question-id={q.question_id}>
                                            <SurveyQuestion question={q} />
                                            {q.options && q.options.length > 0 ? (
                                                <select
                                                    className={styles.responseSelect}
                                                    onChange={(e) => handleResponseChange(q.question_id, e.target.value)}
                                                    value={responses[q.question_id] || ""} required
                                                    aria-label={`Response for question: ${q.content}`}
                                                >
                                                    <option value="" disabled>Select an option</option>
                                                    {q.options.map((option) => (
                                                        <option key={option.option_letter} value={option.option_letter}>
                                                            {option.option_letter}. {option.content}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <textarea
                                                    className={styles.responseTextarea}
                                                    onChange={(e) => handleResponseChange(q.question_id, e.target.value)}
                                                    value={responses[q.question_id] || ""} placeholder="Your answer..." required
                                                    aria-label={`Response for question: ${q.content}`}
                                                ></textarea>
                                            )}
                                        </div>
                                    ))}
                                    <button type="submit" className={styles.submitButton} disabled={submitting}>
                                        {submitting ? 'Submitting...' : 'Submit Survey'}
                                    </button>
                                </form>
                            ) : null /* Render nothing if questions are empty and pageError handles message */}
                        </>
                    )}
                     {/* Always show logout when in authenticated state */}
                    <button onClick={() => handleLogout()} style={{ display: 'block', margin: '30px auto 0', background: '#6c757d', border: 'none', color: 'white', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer' }}>
                        Logout
                    </button>
                </div>
             );

        default:
             console.error(`Rendering: Unknown Auth Status: ${authStatus}`);
             // Fallback for unknown state
             return <div className={styles.loadingMessage}>An unexpected error occurred. Please refresh the page.</div>;
    }
};

export default SurveyPage;