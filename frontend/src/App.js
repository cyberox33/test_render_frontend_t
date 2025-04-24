import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import SurveyPage from './pages/SurveyPage';
import FollowupPage from './pages/FollowupPage';
import RecommendationsPage from './pages/RecommendationsPage';

function App() {
  return (
    <Router>
      <div className="App">
        <h1>Green IT Assessment Platform</h1>
        <Routes>
          <Route path="/survey" element={<SurveyPage />} />
          <Route path="/followup" element={<FollowupPage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          {/* Default route */}
          <Route path="*" element={<Navigate to="/survey" />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
