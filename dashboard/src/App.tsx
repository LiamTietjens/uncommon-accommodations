import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Properties from "./pages/Properties";
import KnowledgeBase from "./pages/KnowledgeBase";
import Tickets from "./pages/Tickets";
import Cooldowns from "./pages/Cooldowns";
import ExtraRequests from "./pages/ExtraRequests";
import Users from "./pages/Users";
import SmsRecipients from "./pages/SmsRecipients";
import UrgencyLevels from "./pages/UrgencyLevels";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="properties" element={<Properties />} />
            <Route path="knowledge-base" element={<KnowledgeBase />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="cooldowns" element={<Cooldowns />} />
            <Route path="extras" element={<ExtraRequests />} />
            <Route path="users" element={<Users />} />
            <Route path="sms-recipients" element={<SmsRecipients />} />
            <Route path="urgency" element={<UrgencyLevels />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
