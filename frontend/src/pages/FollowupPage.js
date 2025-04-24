// src/pages/FollowupPage.js
import React from 'react';
import FollowupQuestions from '../components/FollowupQuestions'; // Adjust path if needed

/**
 * Page component that retrieves the session ID from sessionStorage
 * and renders the FollowupQuestions component.
 */
const FollowupPage = () => {
  // --- CHANGE HERE: Use sessionStorage ---
  // const sessionId = localStorage.getItem("session_id"); // OLD
  const sessionId = sessionStorage.getItem('session_id'); // NEW: Retrieve session ID from sessionStorage
  // --- END CHANGE ---

  // Display a message if the session ID is not found in sessionStorage
  if (!sessionId) {
    // This message will now only show if sessionStorage truly doesn't have the ID
    return (
      <p
        style={{
          color: 'red',
          textAlign: 'center',
          marginTop: '20px',
          padding: '10px',
          border: '1px solid red',
          background: '#ffebee',
        }}
      >
        No session found. Please log in or start the survey again.
      </p>
    );
  }

  // Render the FollowupQuestions component, passing the retrieved sessionId
  return (
    <div className="followup-page">
      {/* Pass the correctly retrieved sessionId */}
      <FollowupQuestions sessionId={sessionId} />
    </div>
  );
};

export default FollowupPage;
