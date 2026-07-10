import { Routes, Route } from 'react-router-dom'
import { ChatWindow } from './components/ChatWindow'
import { AdminPage } from './pages/AdminPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatWindow />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  )
}
