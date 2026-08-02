import { MobileRuntime } from "./mobile";
import Admin from "./Admin";
import Prototype from "./Prototype";

export default function App() {
  if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) {
    return <Admin />;
  }

  return (
    <MobileRuntime>
      <Prototype />
    </MobileRuntime>
  );
}
