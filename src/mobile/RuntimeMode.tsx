import { createContext, type PropsWithChildren, useContext, useMemo } from "react";

type MobileRuntimeMode = {
  simulator: boolean;
};

const MobileRuntimeModeContext = createContext<MobileRuntimeMode | null>(null);

export function MobileRuntimeModeProvider({ children, simulator }: PropsWithChildren<{ simulator: boolean }>) {
  const value = useMemo(() => ({ simulator }), [simulator]);
  return <MobileRuntimeModeContext.Provider value={value}>{children}</MobileRuntimeModeContext.Provider>;
}

export function useMobileRuntimeMode() {
  const context = useContext(MobileRuntimeModeContext);
  if (!context) throw new Error("useMobileRuntimeMode must be used inside MobileRuntime");
  return context;
}
