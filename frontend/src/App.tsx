import { Routes, Route } from 'react-router-dom'
import { ChatWindow } from './components/ChatWindow'
import { AdminPage } from './pages/AdminPage'
import { HistoryPage } from './pages/HistoryPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatWindow />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/history" element={<HistoryPage />} />
    </Routes>
  )
}
