import { useEffect, type PropsWithChildren } from "react";
import { MobileDeviceProvider, useMobileDevice } from "./Device";
import { KeyboardDock, KeyboardProvider, useKeyboard } from "./Keyboard";
import { PhoneFrame } from "./PhoneFrame";
import { HomeIndicator, StatusBar } from "./components";
import { MobileRuntimeModeProvider, useMobileRuntimeMode } from "./RuntimeMode";

type MobileRuntimeProps = PropsWithChildren<{
  simulator?: boolean;
}>;

function requestedLocalSimulator() {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("simulator") === "1";
}

export function MobileRuntime({ children, simulator = requestedLocalSimulator() }: MobileRuntimeProps) {
  return (
    <MobileRuntimeModeProvider simulator={simulator}>
      <MobileDeviceProvider>
        <PhoneFrame simulator={simulator}>
          <KeyboardProvider>
            {simulator ? <KeyboardPreview /> : null}
            {simulator ? <StatusBar /> : null}
            <MobileAppViewport>{children}</MobileAppViewport>
            {simulator ? <HomeIndicator /> : null}
            {simulator ? <KeyboardDock /> : null}
          </KeyboardProvider>
        </PhoneFrame>
      </MobileDeviceProvider>
    </MobileRuntimeModeProvider>
  );
}

function MobileAppViewport({ children }: PropsWithChildren) {
  const { device } = useMobileDevice();
  const keyboard = useKeyboard();
  const { simulator } = useMobileRuntimeMode();

  return (
    <div
      className="mobile-app-viewport"
      data-keyboard-visible={keyboard.visible ? "true" : "false"}
      data-platform={device.platform}
      data-runtime={simulator ? "simulator" : "native"}
      data-testid="mobile-app-viewport"
    >
      {children}
    </div>
  );
}

function KeyboardPreview() {
  const keyboard = useKeyboard();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("keyboard") === "1") {
      keyboard.show();
    }
  }, [keyboard]);

  return null;
}
