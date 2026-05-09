import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Upload from "./pages/Upload";
import DocumentView from "./pages/DocumentView";
import ProtectedRoute from "./components/ProtectedRoute";
import AppPortalLayout from "./components/AppPortalLayout";
import { MarketingShell } from "./components/MarketingChrome";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/"
          element={
            <MarketingShell>
              <Landing />
            </MarketingShell>
          }
        />
        <Route
          path="/login"
          element={
            <MarketingShell>
              <Login />
            </MarketingShell>
          }
        />
        <Route path="/app" element={<AppPortalLayout />}>
          <Route
            index
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="upload"
            element={
              <ProtectedRoute>
                <Upload />
              </ProtectedRoute>
            }
          />
          <Route
            path="doc/:id"
            element={
              <ProtectedRoute>
                <DocumentView />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
