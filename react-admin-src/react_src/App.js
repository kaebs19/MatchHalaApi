import React, { useState } from 'react';
import Login from './pages/Login';
import MainLayout from './layouts/MainLayout';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/shared/index.css';
import './App.css';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(
    localStorage.getItem('isLoggedIn') === 'true'
  );
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  const handleLogin = (userData) => {
    setUser(userData);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setIsLoggedIn(false);
  };

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className="App">
          {isLoggedIn ? (
            <MainLayout onLogout={handleLogout} user={user} />
          ) : (
            <Login onLogin={handleLogin} />
          )}
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
