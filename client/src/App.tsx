import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireRole, useAuth } from './auth';
import { AppLayout } from './components/AppLayout';
import { ActivityPage } from './pages/ActivityPage';
import { LoginPage } from './pages/LoginPage';
import { WorkshopDetailPage } from './pages/WorkshopDetailPage';
import { WorkshopsPage } from './pages/WorkshopsPage';
import { AccountsPage } from './pages/AccountsPage';

/**
 * Landing page. Administrators have no dashboard of their own - they look after
 * staff accounts - so they are sent straight there instead of bouncing off a
 * route they are not allowed to see.
 */
function LandingPage() {
  const { user } = useAuth();
  if (user?.role === 'ADMIN') return <Navigate to="/accounts" replace />;
  return <WorkshopsPage />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<LandingPage />} />
          <Route
            path="workshops/:id"
            element={
              <RequireRole roles={['MANAGER', 'STAFF']}>
                <WorkshopDetailPage />
              </RequireRole>
            }
          />
          <Route
            path="activity"
            element={
              <RequireRole roles={['ADMIN', 'MANAGER']}>
                <ActivityPage />
              </RequireRole>
            }
          />
          <Route
            path="accounts"
            element={
              <RequireRole roles={['ADMIN']}>
                <AccountsPage />
              </RequireRole>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
