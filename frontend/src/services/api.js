import axios from 'axios';

//const API_BASE_URL = "http://127.0.0.1:8000";  // Adjust if necessary
const API_BASE_URL = "https://test-render-backend-jpp0.onrender.com";

// Create an axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
});

// Attach the auth token (if available) to each request
api.interceptors.request.use(
  (config) => {
    // const token = localStorage.getItem("access_token"); // OLD
    const token = sessionStorage.getItem("access_token"); // NEW
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// --- (RECOMMENDED) Response Interceptor for Global Error Handling ---
api.interceptors.response.use(
  (response) => response, // Pass through successful responses
  (error) => {
    // Check if the error is a 401 Unauthorized
    if (error.response && error.response.status === 401) {
      console.warn("API request Unauthorized (401). Forcing logout.");
      // Clear session storage
      sessionStorage.removeItem("access_token");
      sessionStorage.removeItem("session_id");
      // Redirect to login or force re-render to show login
      // Use window.location or trigger a state update via event/callback
      // For simplicity here, we'll reload, which should trigger validation failure
      // A more sophisticated app might use React Router's navigate or a global state.
      window.location.href = '/'; // Or your specific login route path
      // Note: This might be too aggressive if some 401s are expected/handled differently
    }
    // Return the error so component-level catch blocks can still handle it if needed
    return Promise.reject(error);
  }
);


export const createSession = async () => {
    const response = await api.post("/create-session");
    return response.data;  // Should return { session_id: "..." }
  };

// API call to get survey questions
export const getSurveyQuestions = async () => {
  const response = await api.get("/survey-questions");
  return response.data;
};

// API call to submit survey responses
export const submitSurveyResponses = async (responseData) => {
  const response = await api.post("/survey-responses", responseData);
  return response.data;
};

// In src/services/api.js
export const getFollowupQuestions = async (sessionId) => {
  const response = await api.get(`/followup-questions?session_id=${sessionId}`);
  return response.data;
};

export const submitFollowupResponses = async (followupData) => {
  const response = await api.post("/followup-responses", followupData);
  return response.data;
};

// API call for user login
export const loginUser = async (username, password) => {
  const response = await api.post("/token", { username, password });
  return response.data;  // Returns { access_token, token_type }
};

// API call for user registration
export const registerUser = async (username, password) => {
  const response = await api.post("/register", { username, password });
  return response.data;  // Returns { access_token, token_type }
};

// Optional: API call to get current user info
export const getCurrentUser = async () => {
  const response = await api.get("/users/me");
  return response.data;
};

export const getRecommendationsStatus = async (sessionId) => {
  // Ensure session ID is retrieved using sessionStorage if needed here
 if (!sessionId) {
   throw new Error("Session ID is required to get recommendations status.");
 }
 try {
   const response = await api.get(`/recommendations/status/${sessionId}`);
   return response.data;
 } catch (error) {
   console.error("Error fetching recommendations status:", error);
   // Don't automatically assume error status here if the interceptor handles 401
   // Re-throw or handle specific non-auth errors if necessary
   if (error.response && error.response.status !== 401) {
        // Handle non-auth errors specifically if needed
        return { status: "error", error_message: error.message || "Failed to fetch status" };
   }
   // If it's 401, the interceptor might handle it, otherwise re-throw
   throw error;
   // Or return specific error status if you want component to handle non-auth API errors
   // return { status: "error", error_message: error.message || "Failed to fetch status" };
 }
};

export default api;
