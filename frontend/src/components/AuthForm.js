// src/components/AuthForm.js
import React, { useState } from 'react';
// Ensure createSession is imported if not already
import { loginUser, registerUser, createSession } from '../services/api';
import styles from './AuthForm.module.css';

const AuthForm = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null); // For displaying errors inline
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      let authData; // { access_token, token_type }
      if (mode === "login") {
        authData = await loginUser(username, password);
      } else {
        authData = await registerUser(username, password);
      }

      // --- Store token using sessionStorage ---
      sessionStorage.setItem("access_token", authData.access_token);
      console.log(`${mode} successful, token stored.`);

      // --- Create session AFTER getting token ---
      try {
         console.log("Attempting to create session...");
         const sessionData = await createSession(); // Uses the token via interceptor
         // --- Store session ID using sessionStorage ---
         sessionStorage.setItem("session_id", sessionData.session_id);
         console.log("Session created and stored:", sessionData.session_id);

         onAuthSuccess(); // Notify parent AFTER token AND session are stored

      } catch (sessionError) {
         console.error("Failed to create session after login/register:", sessionError);
         setError(`Authentication succeeded, but failed to create a session: ${sessionError.response?.data?.detail || sessionError.message}. Please try logging in again.`);
         // Clean up potentially stored token if session creation fails
         sessionStorage.removeItem("access_token");
      }

    } catch (err) {
      console.error(`${mode} failed:`, err);
      // Use error message from backend if available, otherwise generic
      const message = err.response?.data?.detail || `${mode === 'login' ? 'Login' : 'Registration'} failed. Please check credentials/try again.`;
      setError(message);
       // Clear any potentially half-stored items on failure
       sessionStorage.removeItem("access_token");
       sessionStorage.removeItem("session_id");
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = () => {
      setMode(prevMode => prevMode === "login" ? "register" : "login");
      setError(null);
      setUsername("");
      setPassword("");
  }

  return (
    
    <div className={styles.authContainer}>
      <h2>{mode === "login" ? "Login" : "Register"}</h2>
      <form onSubmit={handleSubmit}>
        <div className={styles.formGroup}>
          <label htmlFor="username">Username:</label>
          <input
            id="username" type="text" value={username}
            onChange={(e) => setUsername(e.target.value)}
            required disabled={isLoading}
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="password">Password:</label>
          <input
            id="password" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            required disabled={isLoading}
          />
        </div>

        {/* --- Display error inline --- */}
        {error && <p className={styles.errorMessage}>{error}</p>}

        <button type="submit" className={styles.submitButton} disabled={isLoading}>
          {/* --- Show loading state --- */}
          {isLoading ? 'Processing...' : (mode === "login" ? "Login" : "Register")}
        </button>
      </form>

      <div className={styles.toggleMode}>
        {mode === "login" ? (
          <p>
            {/* --- Wrap text in <strong> --- */}
            <strong>Don't have an account?</strong>{' '}
            {/* Space is still here */}
            <button type="button" onClick={switchMode} className={styles.toggleButton} disabled={isLoading}>
              Register here
            </button>
          </p>
        ) : (
          <p>
             {/* --- Wrap text in <strong> --- */}
            <strong>Already have an account?</strong>{' '}
            {/* Space is still here */}
            <button type="button" onClick={switchMode} className={styles.toggleButton} disabled={isLoading}>
              Login here
            </button>
          </p>
        )}
      </div>

    </div>
  );
};

export default AuthForm;