import { type CSSProperties, type PropsWithChildren, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useDrag } from "@use-gesture/react";
import { AnimatePresence, motion } from "motion/react";
import { useKeyboard, useKeyboardInsets } from "./Keyboard";
import { useScreenPortal } from "./PhoneFrame";
import { useMobileDevice } from "./Device";
import { useMobileRuntimeMode } from "./RuntimeMode";

type BottomSheetProps = PropsWithChildren<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  snap?: number;
}>;

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  snap = 0.72,
  children,
}: BottomSheetProps) {
  const { device } = useMobileDevice();
  const { simulator } = useMobileRuntimeMode();
  const { screenRef } = useScreenPortal();
  const keyboard = useKeyboard();
  const { keyboardHeight } = useKeyboardInsets();
  const [dragY, setDragY] = useState(0);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    keyboard.hide();
    setDragY(0);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [open, snap, title]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      keyboard.hide();
    }

    onOpenChange(nextOpen);
  };

  const bindDrag = useDrag(
    (state) => {
      const [, movementY] = state.movement;
      const [, velocityY] = state.velocity;
      const [, directionY] = state.direction;
      const nextY = Math.max(0, movementY);

      if (!state.last) {
        setDragY(nextY);
        return;
      }

      const shouldClose = nextY > 96 || (velocityY > 0.55 && directionY > 0);
      setDragY(0);

      if (shouldClose) {
        onOpenChange(false);
      }
    },
    {
      axis: "y",
      filterTaps: true,
    },
  );

  const sheetBottom =
    device.platform === "android"
      ? Math.max(device.geometry.safeArea.bottom, keyboardHeight)
      : keyboardHeight;
  const sheetHeight = Math.round(device.geometry.screen.height * snap);
  const topClearance = device.geometry.safeArea.top + 8;
  const availableHeight = Math.max(0, device.geometry.screen.height - topClearance - sheetBottom);
  const effectiveHeight = Math.min(sheetHeight, availableHeight);
  const minimumHeight = Math.min(260, effectiveHeight);
  const contentSafeArea = device.platform === "ios" && keyboardHeight === 0
    ? device.geometry.safeArea.bottom
    : 0;
  const portalContainer = screenRef.current ?? undefined;
  const animationDistance = simulator
    ? effectiveHeight + 36
    : Math.round((typeof window === "undefined" ? device.geometry.screen.height : window.innerHeight) * snap) + 36;
  const sheetStyle = simulator
    ? {
        bottom: sheetBottom,
        maxHeight: effectiveHeight,
        minHeight: minimumHeight,
        "--sheet-content-safe-area": `${contentSafeArea}px`,
      }
    : {
        "--native-sheet-height": `${Math.round(snap * 100)}dvh`,
      };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      {/* Keep the portal mounted after `open` flips so AnimatePresence can run
          the sheet and overlay exit animations before Radix removes them. */}
      <Dialog.Portal container={portalContainer} forceMount>
        <AnimatePresence>
          {open ? (
            <>
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  className="sheet-overlay"
                  data-testid="sheet-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount>
                <motion.div
                  className="bottom-sheet"
                  data-testid="bottom-sheet"
                  data-runtime={simulator ? "simulator" : "native"}
                  style={sheetStyle as CSSProperties}
                  initial={{ y: animationDistance }}
                  animate={{ y: dragY }}
                  exit={{
                    y: animationDistance,
                    transition: {
                      type: "spring",
                      stiffness: 250,
                      damping: 30,
                      mass: 1.05,
                    },
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 43,
                    mass: 0.9,
                  }}
                >
                  <div className="sheet-handle-zone" data-testid="sheet-handle" {...bindDrag()} onClick={() => keyboard.hide()}>
                    <div className="sheet-handle" />
                  </div>
                  <div className="sheet-header">
                    <Dialog.Title className="sheet-title">{title}</Dialog.Title>
                    {description ? <Dialog.Description className="sheet-description">{description}</Dialog.Description> : null}
                  </div>
                  <div ref={contentRef} className="sheet-content">{children}</div>
                </motion.div>
              </Dialog.Content>
            </>
          ) : null}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
