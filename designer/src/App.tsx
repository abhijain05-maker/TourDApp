import { Route, Routes } from 'react-router-dom'
import AppShell from './shell/AppShell'
import ProjectsPage from './pages/ProjectsPage'
import ProjectPage from './pages/ProjectPage'
import TestPlanPage from './pages/TestPlanPage'
import TourPage from './pages/TourPage'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/tours/:id" element={<TourPage />} />
        <Route path="/tests/:id" element={<TestPlanPage />} />
        <Route path="*" element={<ProjectsPage />} />
      </Routes>
    </AppShell>
  )
}
