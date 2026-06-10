import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import PropertiesKB from "./pages/PropertiesKB";
import Tickets from "./pages/Tickets";
import AgentConfig from "./pages/AgentConfig";
import Users from "./pages/Users";
import SmsRecipients from "./pages/SmsRecipients";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/screenshot" element={
            <div style={{ background: "#f9fafb", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", padding: "2rem" }}>
              <img src="/screenshot/preview.png" alt="Uncommon Accommodations Dashboard" style={{ maxWidth: "100%", height: "auto", borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.1)" }} />
            </div>
          } />
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="properties" element={<PropertiesKB />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="agent-config" element={<AgentConfig />} />
            <Route path="users" element={<Users />} />
            <Route path="sms-recipients" element={<SmsRecipients />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
