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
