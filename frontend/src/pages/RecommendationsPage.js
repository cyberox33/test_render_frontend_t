import React, { useEffect, useState, useRef } from 'react';
import { getRecommendationsStatus } from '../services/api';
//import './RecommendationsPage.css'; // Add styling

const RecommendationsPage = () => {
  const [status, setStatus] = useState("loading"); // loading, generating, ready, error
  const [reportUrl, setReportUrl] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const sessionId = sessionStorage.getItem("session_id"); // Ensure session_id is stored correctly after login/session creation
  const intervalRef = useRef(null); // Ref to hold interval ID

  const checkStatus = async () => {
      if (!sessionId) {
          setStatus("error");
          setErrorMessage("Session ID not found. Please start a new assessment.");
          return;
      }
      console.log("Checking recommendation status...");
      try {
          const result = await getRecommendationsStatus(sessionId);
          setStatus(result.status);
          setReportUrl(result.url || null); // Store URL if ready
          setErrorMessage(result.error_message || '');

          if (result.status === "ready" || result.status === "error") {
              console.log(`Stopping polling. Status: ${result.status}`);
              if (intervalRef.current) {
                  clearInterval(intervalRef.current);
                  intervalRef.current = null; // Clear ref
              }
          }
      } catch (apiError) { // Catch errors from the API call itself
          console.error("API error checking status:", apiError);
          setStatus("error");
          setErrorMessage("Could not connect to the server to check status.");
          if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null; // Clear ref on API error too
          }
      }
  };

  useEffect(() => {
      checkStatus(); // Initial check

      // Set up polling only if status is initially loading or generating
      if (status === "loading" || status === "generating") {
          intervalRef.current = setInterval(checkStatus, 15000); // Poll every 15 seconds
          console.log("Polling started...");
      }

      // Cleanup function
      return () => {
          if (intervalRef.current) {
              console.log("Clearing polling interval on unmount.");
              clearInterval(intervalRef.current);
          }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, status]); // Re-run effect if sessionId or status changes (to stop polling)

  const renderContent = () => {
      switch (status) {
          case "loading":
              return <p>Loading status...</p>;
          case "generating":
              return (
                  <div className="generating-notice">
                      <h2>Generating Recommendations Report...</h2>
                      <p>This may take several minutes. Please wait.</p>
                      {/* Optional: Add a loading spinner */}
                  </div>
              );
          case "ready":
              return (
                  <div className="report-ready">
                      <h2>Recommendations Report Ready</h2>
                      <p>Your personalized PowerPoint report is ready for download.</p>
                      {reportUrl ? (
                          <a
                              href={reportUrl}
                              download={`recommendations_${sessionId}.pptx`} // Suggest .pptx filename
                              className="download-button"
                          >
                              Download Report (.pptx)
                          </a>
                      ) : (
                          <p className="error-message">Error: Download URL is missing.</p>
                      )}
                      {/* Iframe for PPTX might not work well, removed */}
                  </div>
              );
          case "error":
              return (
                  <div className="error-notice">
                      <h2>Error Generating Report</h2>
                      <p>Sorry, an error occurred while generating your report.</p>
                      {errorMessage && <p>Details: {errorMessage}</p>}
                      {/* Optional: Add a retry button or contact support info */}
                  </div>
              );
          case "not_found": // If backend explicitly returns not_found
               return <p>Report not found for this session.</p>;
          default:
              return <p>Checking status...</p>;
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