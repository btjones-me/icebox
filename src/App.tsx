import { useEffect, useState } from "react";
import { MobileRuntime } from "./mobile";
import Admin from "./Admin";
import AuthGate from "./AuthGate";
import Prototype from "./Prototype";

function isAdminRoute() {
  const pathRoute = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
  const hashRoute = window.location.hash === "#/admin" || window.location.hash.startsWith("#/admin/");
  return pathRoute || hashRoute;
}

export default function App() {
  const [adminRoute, setAdminRoute] = useState(isAdminRoute);

  useEffect(() => {
    const updateRoute = () => setAdminRoute(isAdminRoute());
    window.addEventListener("hashchange", updateRoute);
    window.addEventListener("popstate", updateRoute);
    return () => {
      window.removeEventListener("hashchange", updateRoute);
      window.removeEventListener("popstate", updateRoute);
    };
  }, []);

  return (
    <AuthGate
      offlineChildren={adminRoute ? (
        <main className="auth-screen"><section className="auth-card"><p className="auth-brand">Icebox</p><h1>Admin is unavailable offline</h1><p>Reconnect to manage households and pilot access.</p></section></main>
      ) : (
        <MobileRuntime><Prototype initialOffline /></MobileRuntime>
      )}
    >
      {adminRoute ? <Admin /> : <MobileRuntime><Prototype /></MobileRuntime>}
    </AuthGate>
  );
}
