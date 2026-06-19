import axios from 'axios';

// All requests go through the API Gateway on port 3000
const api = axios.create({
  baseURL: 'http://localhost:3000',
});

// Automatically attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;