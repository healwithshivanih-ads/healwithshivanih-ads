import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { isLoggedIn } from './api.js';
import Login from './pages/Login.jsx';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import Conversations from './pages/Conversations.jsx';
import ConversationView from './pages/ConversationView.jsx';
import Appointments from './pages/Appointments.jsx';
import SendTemplate from './pages/SendTemplate.jsx';

function Guard({ children }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Guard><Layout /></Guard>}>
        <Route index element={<Dashboard />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="conversations" element={<Conversations />} />
        <Route path="conversations/:id" element={<ConversationView />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="send-template" element={<SendTemplate />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
