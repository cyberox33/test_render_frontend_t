import React from 'react';
import styles from './SurveyQuestion.module.css'; // Import styles

const SurveyQuestion = ({ question }) => {
  // Basic check if question data is available
  if (!question) {
    return <div>Loading question...</div>;
  }

  return (
    // Removed the outer div as the parent (.questionBlock) handles spacing/border
    <>
      <h3 className={styles.questionContent}>{question.content}</h3>
      {question.options && question.options.length > 0 && ( // Check if options exist and is array
        <ul className={styles.optionsList}>
          {question.options.map((option) => (
            <li key={option.option_letter} className={styles.optionItem}>
              <span className={styles.optionLetter}>{option.option_letter}.</span> {option.content}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export default SurveyQuestion;