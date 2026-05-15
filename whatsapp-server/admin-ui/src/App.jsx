import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { isLoggedIn } from './api.js';
import Login from './pages/Login.jsx';
import Layout from './components/Layout.jsx';
import Inbox from './pages/Inbox.jsx';
import Broadcast from './pages/Broadcast.jsx';
import Contacts from './pages/Contacts.jsx';
import ContactDetail from './pages/ContactDetail.jsx';
import Appointments from './pages/Appointments.jsx';
import Settings from './pages/Settings.jsx';
import Integrations from './pages/Settings/Integrations.jsx';
import Imports from './pages/Settings/Imports.jsx';
import Workspace from './pages/Settings/Workspace.jsx';

function Guard({ children }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Guard><Layout /></Guard>}>
        <Route index element={<Navigate to="/inbox" replace />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="inbox/:id" element={<Inbox />} />
        <Route path="broadcast" element={<Broadcast />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="contacts/:id" element={<ContactDetail />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="settings" element={<Settings />}>
          <Route path="integrations" element={<Integrations />} />
          <Route path="imports" element={<Imports />} />
          <Route path="workspace" element={<Workspace />} />
        </Route>
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Route>
    </Routes>
  );
}
