import React, { useEffect, useState, useRef, useCallback } from 'react';
import { getRecommendationsStatus } from '../services/api';
//import './RecommendationsPage.css'; // Add styling

// Define expected statuses from the backend
const FinalStatus = {
    READY: 'ready',
    ERROR: 'error',
    NOT_FOUND: 'not_found'
};

const POLLING_INTERVAL_REC_MS = 15000; // Poll every 15 seconds

const RecommendationsPage = () => {
  const [status, setStatus] = useState("loading"); // loading, pipeline_running, generating_report, ready, error, not_found
  const [reportUrl, setReportUrl] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const sessionId = sessionStorage.getItem("session_id");
  const timeoutRef = useRef(null); // Ref for setTimeout ID
  const isMounted = useRef(true); // Track mount status

  // --- Polling Function ---
  const checkStatus = useCallback(async () => {
      if (!isMounted.current || !sessionId) return; // Stop if unmounted or no session

      console.log("Checking recommendation status...");
      let shouldStopPolling = false;
      let nextStatus = "error"; // Default if something goes wrong
      let nextErrorMessage = '';
      let nextReportUrl = null;

      try {
          const result = await getRecommendationsStatus(sessionId);
          if (!isMounted.current) return; // Check again after await

          console.log("Status API Result:", result);
          nextStatus = result.status;
          nextReportUrl = result.url || null;
          nextErrorMessage = result.error_message || '';

          // Check if status is final
          if (nextStatus === FinalStatus.READY || nextStatus === FinalStatus.ERROR || nextStatus === FinalStatus.NOT_FOUND) {
              console.log(`Stopping polling. Final Status: ${nextStatus}`);
              shouldStopPolling = true;
          }

      } catch (apiError) {
          if (!isMounted.current) return;
          console.error("API error checking status:", apiError);
          nextStatus = FinalStatus.ERROR;
          nextErrorMessage = "Could not connect to the server to check status.";
          shouldStopPolling = true; // Stop polling on API error
      } finally {
          if (isMounted.current) {
              // Update state only if it changed to avoid unnecessary re-renders
              setStatus(prevStatus => prevStatus === nextStatus ? prevStatus : nextStatus);
              setReportUrl(prevUrl => prevUrl === nextReportUrl ? prevUrl : nextReportUrl);
              setErrorMessage(prevMsg => prevMsg === nextErrorMessage ? prevMsg : nextErrorMessage);

              // Schedule next poll ONLY if not stopped
              if (!shouldStopPolling) {
                  // console.log(`Scheduling next status check in ${POLLING_INTERVAL_REC_MS}ms`);
                  timeoutRef.current = setTimeout(checkStatus, POLLING_INTERVAL_REC_MS);
              }
          }
      }
  }, [sessionId]); // Depends only on sessionId (stable)


  // --- useEffect for Initial Load & Starting Polling ---
  useEffect(() => {
      isMounted.current = true;
      setStatus("loading"); // Set initial status

      if (!sessionId) {
          setStatus("error");
          setErrorMessage("Session ID not found. Please start a new assessment.");
          return; // Don't start polling
      }

      // Start the first check immediately
      checkStatus();

      // Cleanup function
      return () => {
          isMounted.current = false;
          if (timeoutRef.current) {
              console.log("Clearing recommendations polling timeout on unmount.");
              clearTimeout(timeoutRef.current);
          }
      };
      // Effect only depends on sessionId and the stable checkStatus callback
  }, [sessionId, checkStatus]);


  // --- Render Logic ---
  const renderContent = () => {
      switch (status) {
          case "loading":
              return <p>Loading status...</p>;
          // NEW CASE: Handle the phase where RAG is running but report generation hasn't started
          case "pipeline_running":
              return (
                  <div className="generating-notice">
                      <h2>Processing Assessment Data...</h2>
                      <p>The system is analyzing your responses and may ask follow-up questions if needed elsewhere. Please wait.</p>
                      {/* Optional: Add a loading spinner */}
                  </div>
              );
          // Existing case for when report generation is definitely active
          case "generating_report":
              return (
                  <div className="generating-notice">
                      <h2>Generating Recommendations Report...</h2>
                      <p>This may take several minutes. Please wait.</p>
                      {/* Optional: Add a loading spinner */}
                  </div>
              );
          case FinalStatus.READY:
              return (
                  <div className="report-ready">
                      <h2>Recommendations Report Ready</h2>
                      <p>Your personalized PowerPoint report is ready for download.</p>
                      {reportUrl ? (
                          <a
                              href={reportUrl}
                              download={`recommendations_${sessionId}.pptx`}
                              className="download-button"
                          >
                              Download Report (.pptx)
                          </a>
                      ) : (
                          <p className="error-message">Error: Download URL is missing, although status is ready.</p>
                      )}
                  </div>
              );
           case FinalStatus.ERROR:
              return (
                  <div className="error-notice">
                      <h2>Error Generating Report</h2>
                      <p>Sorry, an error occurred while generating or processing your report.</p>
                      {errorMessage && <p>Details: {errorMessage}</p>}
                  </div>
              );
          case FinalStatus.NOT_FOUND:
               return <p>Report status not found for this session ID.</p>;
          default:
               // Handle any unexpected status from backend gracefully
               console.warn("RecommendationsPage received unexpected status:", status);
               return <p>Checking status ({status})...</p>;
      }
  };

  return (
      <div className="recommendations-page">
          <h1>Assessment Report</h1>
          {!sessionId && <p className="error-message">No active session found.</p>}
          {sessionId && renderContent()}
      </div>
  );
};

export default RecommendationsPage;