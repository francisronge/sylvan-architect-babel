import React from 'react';
import { createRoot } from 'react-dom/client';
import { QualificationReview } from './reviewComponents';
import '../styles.css';
import './review.css';

const source = document.getElementById('review-data');
const root = document.getElementById('root');
if (!source || !root) throw new Error('Missing qualification review document elements.');
createRoot(root).render(<QualificationReview data={JSON.parse(source.textContent || '{}')} />);
