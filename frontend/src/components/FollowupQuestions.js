import React, {
    useEffect,
    useState,
    useCallback,
    useRef
  } from 'react';
  import {
    useNavigate
  } from 'react-router-dom'; // Keep if using the optional button
  
  // Assume these are correctly imported from your project structure
  import {
    getFollowupQuestions,
    submitFollowupResponses
  } from '../services/api';
  
  // import './FollowupQuestions.css'; // Uncomment or create this file for styling
  
  /**
   * Component to display and handle follow-up questions fetched periodically.
   * @param {object} props - Component props.
   * @param {string} props.sessionId - The unique ID for the current user session.
   */
  const FollowupQuestions = ({
    sessionId
  }) => {
    // State for storing the list of follow-up questions from the API
    const [followupQuestions, setFollowupQuestions] = useState([]);
    // State to indicate if the component is initially loading questions
    const [loading, setLoading] = useState(true);
    // State to store user's answers, keyed by question_id
    const [answers, setAnswers] = useState({});
    // State to indicate if answers are currently being submitted
    const [submitting, setSubmitting] = useState(false);
    // State to store any error messages
    const [error, setError] = useState('');
  
    // Hook for programmatic navigation (optional)
    const navigate = useNavigate();
    // Ref to store the interval ID for polling, used for cleanup
    const intervalRef = useRef(null);
  
    /**
     * Fetches follow-up questions from the API and updates the component state.
     * Memoized with useCallback to stabilize its reference.
     */
    const fetchAndSetQuestions = useCallback(async () => {
      // console.log("Polling for followup questions..."); // Keep commented unless debugging needed
      setError(''); // Clear previous errors on new fetch attempt
  
      try {
        const data = await getFollowupQuestions(sessionId);
        // console.log("API Response Data:", data); // Keep for debugging if needed
  
        if (data === null || data === undefined) {
          console.warn("API returned null/undefined data.");
          setError("Failed to fetch questions from server. Retrying...");
        } else {
          setFollowupQuestions(data); // Update state with current questions
  
          // Initialize answers state only for *newly* arrived questions
          // Prevents overwriting user input if the same questions are fetched again
          setAnswers((prev) => {
            const newAnswers = { ...prev
            };
            let needsUpdate = false; // Flag to check if any new questions were added
  
            data.forEach((q) => {
              if (!(q.question_id in newAnswers)) { // Only initialize if not already present
                needsUpdate = true;
                const fields = q.additional_fields || {};
                const multiOptions = fields.multiple_correct_answer_options || [];
  
                if (multiOptions.length > 0) { // Init for multi-select structure
                  newAnswers[q.question_id] = {
                    values: [],
                    subjective_value: '',
                  };
                } else { // Init for single select / subjective
                  newAnswers[q.question_id] = '';
                }
              }
            });
  
            // Return the updated state only if new questions were initialized
            return needsUpdate ? newAnswers : prev;
          });
        }
  
        // Ensure loading is set to false after the first fetch attempt (success or handled error)
        // Check the loading state directly to avoid dependency loop issues
        setLoading(false); // Set loading false after first attempt
  
      } catch (fetchError) {
        console.error('Error retrieving follow-up questions:', fetchError);
        setError('Failed to load questions. Retrying in background...');
        setLoading(false); // Ensure loading stops even on initial error
      }
      // Note: 'loading' state was intentionally removed from the dependency array previously
      // to prevent potential infinite loops if fetch errors occurred repeatedly.
      // The logic now sets loading to false directly within the function.
    }, [sessionId]); // Dependency: only re-create if sessionId changes
  
    /**
     * Effect hook for polling the API for questions on mount and when sessionId changes.
     * Sets up and clears the polling interval.
     */
    useEffect(() => {
      if (!sessionId) {
        setError('No Session ID provided.');
        setLoading(false);
        return; // Stop if no session ID
      }
  
      setLoading(true); // Set loading true when effect runs
      fetchAndSetQuestions(); // Perform initial fetch immediately
  
      // console.log("Starting followup polling interval...");
      // Set up interval to call fetchAndSetQuestions periodically
      intervalRef.current = setInterval(fetchAndSetQuestions, 10000); // Poll every 10 seconds
  
      // Cleanup function: Runs when component unmounts or before effect runs again
      return () => {
        // console.log("Stopping followup polling (cleanup).");
        if (intervalRef.current) {
          clearInterval(intervalRef.current); // Clear interval to prevent memory leaks
        }
      };
      // Dependencies: Re-run if sessionId or the memoized fetch function changes
    }, [sessionId, fetchAndSetQuestions]);
  
    // --- Answer Handlers ---
  
    /**
     * Handles changes for simple input types (dropdowns, pure subjective textareas).
     * @param {string} questionId - The ID of the question being answered.
     * @param {string} value - The selected value or text input.
     */
    const handleAnswerChange = (questionId, value) => {
      setAnswers((prev) => ({ ...prev,
        [questionId]: value
      }));
    };
  
    /**
     * Handles changes for multi-select checkbox groups.
     * @param {string} questionId - The ID of the question.
     * @param {string[]} selectedOptions - An array of the currently selected checkbox values.
     */
    const handleMultiSelectChange = (questionId, selectedOptions) => {
      setAnswers((prev) => ({
        ...prev,
        [questionId]: {
          ...(prev[questionId] || { // Ensure the object structure exists
            values: [],
            subjective_value: '',
          }),
          values: selectedOptions, // Update the array of selected values
        },
      }));
    };
  
    /**
     * Handles changes for the subjective text input field.
     * Differentiates between subjective input within a multi-select ("Other")
     * and a standalone subjective question.
     * @param {string} questionId - The ID of the question.
     * @param {string} value - The text entered by the user.
     */
    const handleSubjectiveInputChange = (questionId, value) => {
      const currentQuestion = followupQuestions.find(
        (q) => q.question_id === questionId
      );
      if (!currentQuestion) return; // Safety check
  
      const fields = currentQuestion.additional_fields || {};
      const multiOptions = fields.multiple_correct_answer_options || [];
      const subjectiveAnswerField = fields.subjective_answer || [];
  
      if (multiOptions.length > 0) {
        // Input belongs to a multi-select question with a subjective "Other" field
        setAnswers((prev) => ({
          ...prev,
          [questionId]: {
            ...(prev[questionId] || { // Ensure structure
              values: [],
              subjective_value: '',
            }),
            subjective_value: value, // Update only the subjective part
          },
        }));
      } else if (subjectiveAnswerField.length > 0) {
        // Input is for a purely subjective question (uses simple string state)
        handleAnswerChange(questionId, value);
      }
    };
  
    // --- Submit Handler ---
  
    /**
     * Prepares the payload and submits the collected answers to the API.
     */
    const handleSubmit = async () => {
      setSubmitting(true); // Indicate submission is in progress
      setError(''); // Clear previous submission errors
  
      // Map the current questions and their answers into the required payload format
      const payload = followupQuestions.map((q) => {
        const qId = q.question_id;
        const answerState = answers[qId]; // Could be string or { values: [], subjective_value: "" }
        let answerPayload = {}; // Default to empty object for JSONB storage
  
        const fields = q.additional_fields || {};
        const multiOptions = fields.multiple_correct_answer_options || [];
        const subjectiveAnswerField = fields.subjective_answer || [];
  
        // Determine the structure of the answer based on question type
        if (multiOptions.length > 0) {
          // Multi-select question type
          const currentValues = answerState?.values || [];
          const currentSubjective = answerState?.subjective_value || '';
          // Include if selections were made OR subjective field was filled
          if (currentValues.length > 0 || currentSubjective.trim() !== '') {
            answerPayload = {
              values: currentValues,
              subjective_value: currentSubjective.trim(), // Send trimmed subjective value
            };
          }
          // Handle case where only the subjective "Other" option existed but was left blank
          // (Currently sends {} if nothing selected/entered)
          else if (multiOptions.includes('') && multiOptions.length === 1) {
             answerPayload = { values: [], subjective_value: "" }; // Explicitly send empty structure
          }
  
        } else if (subjectiveAnswerField.length > 0) {
          // Pure subjective question type
          if (typeof answerState === 'string' && answerState.trim() !== '') {
            answerPayload = {
              value: answerState.trim(),
            };
          } else {
            // Send explicitly empty value if user cleared the textarea
            answerPayload = {
              value: '',
            };
          }
        } else {
          // Single-select dropdown type (assuming answer_options exist)
          if (typeof answerState === 'string' && answerState !== '') { // Check if a selection was made
            answerPayload = {
              value: answerState,
            };
          }
          // If dropdown left at default "-- Select --", answerPayload remains {}
        }
  
        // Ensure answerPayload is never null/undefined if we intend to store '{}' in JSONB
        // This check might be redundant given the logic above defaults to {}
        if (answerPayload === null || answerPayload === undefined) {
          answerPayload = {};
        }
  
        // Return the structured item for the payload array
        return {
          session_id: sessionId,
          question_id: qId,
          question: q.question, // Include original question text for context
          category: q.category,
          subcategory: q.subcategory,
          answer: answerPayload, // The structured answer (or {} if unanswered)
        };
      });
  
      // Filter out questions where the user provided no input at all
      const filteredPayload = payload.filter(
        (item) => Object.keys(item.answer).length > 0
      );
  
      // Check if any answers are actually being submitted
      if (filteredPayload.length === 0) {
        alert('Please answer at least one question before submitting.');
        setSubmitting(false);
        return; // Stop submission
      }
  
      console.log('Submitting Payload:', JSON.stringify(filteredPayload, null, 2));
  
      try {
        // Attempt to submit the filtered payload to the API
        await submitFollowupResponses(filteredPayload);
        alert('Answers submitted successfully.');
        // Let polling handle fetching the updated (likely empty) question list.
        // Optionally clear local answers state: setAnswers({});
      } catch (submitError) {
        console.error('Error submitting follow-up responses:', submitError);
        // Try to get a meaningful error message
        const errorMsg =
          submitError.response?.data?.detail ||
          submitError.message ||
          'Unknown error';
        setError(`Submission failed: ${errorMsg}. Please try again.`);
        alert(`Submission failed: ${errorMsg}`); // Also show alert
      } finally {
        // Ensure submitting state is reset regardless of success or failure
        setSubmitting(false);
      }
    };
  
    // --- Rendering Logic for Inputs ---
  
    /**
     * Renders the appropriate input element(s) based on the question's configuration.
     * @param {object} q - The question object.
     * @returns {JSX.Element} The JSX for the question's input field(s).
     */
    const renderQuestionInput = (q) => {
      const qId = q.question_id;
      const fields = q.additional_fields || {};
      const answerOptions = fields.answer_options || []; // For single-select dropdown
      const subjectiveAnswerField = fields.subjective_answer || []; // For pure subjective textarea
      const multiOptions = fields.multiple_correct_answer_options || []; // For multi-select checkboxes
      // Check if the multi-options array includes an empty string, signifying an "Other" text input
      const hasSubjectiveInMulti = multiOptions.includes('');
  
      // --- Render Multi-select Checkboxes (potentially with subjective input) ---
      if (multiOptions.length > 0) {
        const currentAnswerState = answers[qId] || {
          values: [],
          subjective_value: '',
        }; // Default structure
        const currentSelections = currentAnswerState.values || [];
  
        return (
          <div className="multi-select-options">
            <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>
              Select all that apply:
            </p>
            {/* Map through options, filtering out the empty string placeholder */}
            {multiOptions
              .filter((opt) => opt !== '')
              .map((option, index) => (
                <div
                  key={index}
                  className="checkbox-option"
                  style={{ marginBottom: '5px' }}
                >
                  <input
                    type="checkbox"
                    id={`${qId}-${index}`}
                    value={option}
                    checked={currentSelections.includes(option)}
                    onChange={(e) => {
                      const { value, checked } = e.target;
                      // Add or remove the value from the selection array
                      const newSelected = checked
                        ? [...currentSelections, value]
                        : currentSelections.filter((v) => v !== value);
                      handleMultiSelectChange(qId, newSelected);
                    }}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                  />
                  <label
                    htmlFor={`${qId}-${index}`}
                    style={{ cursor: 'pointer' }}
                  >
                    {option}
                  </label>
                </div>
              ))}
  
            {/* Render the subjective input field if the placeholder was present */}
            {hasSubjectiveInMulti && (
              <div className="subjective-input" style={{ marginTop: '10px' }}>
                <label
                  htmlFor={`${qId}-subjective`}
                  style={{
                    display: 'block',
                    marginBottom: '5px',
                    fontWeight: 'bold',
                  }}
                >
                  Other (please specify):
                </label>
                <textarea
                  id={`${qId}-subjective`}
                  placeholder="Provide details here..."
                  value={currentAnswerState.subjective_value || ''}
                  onChange={(e) =>
                    handleSubjectiveInputChange(qId, e.target.value)
                  }
                  rows={3}
                  style={{
                    width: '95%',
                    padding: '8px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    boxSizing: 'border-box', // Ensures padding doesn't add to width
                  }}
                />
              </div>
            )}
          </div>
        );
      }
  
      // --- Render Single-select Dropdown ---
      else if (answerOptions.length > 0) {
        return (
          <select
            value={answers[qId] || ''} // Expects a string value, default to empty
            onChange={(e) => handleAnswerChange(qId, e.target.value)}
            className="single-select"
            style={{
              padding: '10px 8px',
              minWidth: '250px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer',
              boxSizing: 'border-box',
            }}
          >
            <option value="" disabled>
              -- Select an option --
            </option>
            {answerOptions.map((option, index) => (
              <option key={index} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      }
  
      // --- Render Pure Subjective Textarea ---
      else if (subjectiveAnswerField.length > 0) {
        return (
          <textarea
            value={answers[qId] || ''} // Expects a string value
            onChange={(e) => handleAnswerChange(qId, e.target.value)}
            placeholder="Your answer..."
            className="subjective-textarea"
            rows={4}
            style={{
              width: '95%',
              padding: '8px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          />
        );
      }
  
      // --- Fallback if question type isn't recognized ---
      else {
        return (
          <p>
            <i>(No input options defined for this question type)</i>
          </p>
        );
      }
    };
  
    // --- Main Return Logic ---
  
    // Display error if sessionId is missing
    if (!sessionId) {
      return (
        <div
          className="error-message"
          style={{
            color: 'red',
            padding: '20px',
            border: '1px solid red',
            margin: '20px',
            borderRadius: '5px',
            textAlign: 'center',
          }}
        >
          Error: No session ID found. Please start the process over.
        </div>
      );
    }
  
    // Display loading indicator during initial fetch
    if (loading) {
      return (
        <div
          className="loading-screen"
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#555',
          }}
        >
          <h2>Checking for follow-up questions...</h2>
          <p>Please wait.</p>
          {/* Consider adding a spinner component here */}
          <div style={{ marginTop: '20px', height: '30px' }}>
            <span>Loading...</span> {/* Placeholder */}
          </div>
           {/* Display transient fetch errors during initial load */}
           {error && <p style={{ color: 'orange', marginTop: '10px' }}>{error}</p>}
        </div>
      );
    }
  
    // Main render: Display questions or the "No questions" message
    return (
      <div
        className="followup-questions-container"
        style={{
          padding: '20px',
          maxWidth: '800px',
          margin: '20px auto', // Center the container
          fontFamily: 'Arial, sans-serif', // Basic font
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
          background: '#fff',
        }}
      >
        <h1 style={{ textAlign: 'center', marginBottom: '25px', color: '#333' }}>
          Follow-Up Questions
        </h1>
  
        {/* Display persistent errors (e.g., submission errors) */}
        {error && !loading && ( // Show only if not in initial loading state
          <p
            className="error-message"
            style={{
              color: 'red',
              border: '1px solid red',
              padding: '10px 15px',
              marginBottom: '20px',
              borderRadius: '4px',
              background: '#ffebee', // Light red background
            }}
          >
            {error}
          </p>
        )}
  
        {/* Check if there are questions to display */}
        {followupQuestions.length > 0 ? (
          <>
            <p style={{ marginBottom: '20px', color: '#555' }}>
              Please answer the following questions to help refine the assessment.
            </p>
            <div className="questions-list">
              {followupQuestions.map((q) => (
                <div
                  key={q.question_id}
                  className="question-card"
                  style={{
                    border: '1px solid #ddd',
                    padding: '20px',
                    marginBottom: '20px',
                    borderRadius: '5px',
                    background: '#f9f9f9', // Light background for card
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  }}
                >
                  <h3
                    style={{
                      marginTop: '0',
                      marginBottom: '10px',
                      color: '#444',
                      fontSize: '1.1em', // Slightly larger question text
                    }}
                  >
                    {/* Optionally display question ID: `${q.question_id}. ` */}
                    {q.question}
                  </h3>
  
                  {/* Display guidelines if available */}
                  {q.additional_fields?.guidelines && (
                    <p
                      className="guidelines"
                      style={{
                        fontSize: '0.9em',
                        color: '#666',
                        margin: '0 0 15px 0', // Adjusted margin
                        fontStyle: 'italic',
                        borderLeft: '3px solid #007bff', // Accent line
                        padding: '8px 10px', // Padding inside guideline box
                        background: '#e7f3ff', // Light blue background
                        borderRadius: '3px',
                      }}
                    >
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
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                marginTop: '10px', // Reduced top margin
                padding: '12px 25px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontSize: '1.05em',
                backgroundColor: submitting ? '#ccc' : '#007bff', // Blue button
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                opacity: submitting ? 0.7 : 1,
                display: 'block', // Make it block level
                width: '100%', // Make it full width
                boxSizing: 'border-box', // Include padding in width
              }}
            >
              {submitting ? 'Submitting...' : 'Submit Answers'}
            </button>
          </>
        ) : (
          /* Display message when no questions are available (and not loading) */
          <div
            className="no-questions-message"
            style={{
              padding: '30px 20px',
              textAlign: 'center',
              color: '#555',
              background: '#f0f0f0', // Light grey background
              borderRadius: '5px',
            }}
          >
            <h2>No follow-up questions available at this moment.</h2>
            <p>Polling for new questions in the background.</p>
            <p>
              The assessment process may be complete, or the final report might
              be generating.
            </p>
            <p>
              You can navigate to the Recommendations page to check the report
              status.
            </p>
  
            {/* Optional: Button to navigate elsewhere */}
            <button
              onClick={() => navigate('/recommendations')} // Adjust route as needed
              style={{
                marginTop: '20px',
                padding: '10px 18px',
                cursor: 'pointer',
                fontSize: '1em',
                backgroundColor: '#6c757d', // Grey button
                color: 'white',
                border: 'none',
                borderRadius: '5px',
              }}
            >
              Go to Recommendations Page
            </button>
          </div>
        )}
      </div>
    );
  };
  
  export default FollowupQuestions;
  