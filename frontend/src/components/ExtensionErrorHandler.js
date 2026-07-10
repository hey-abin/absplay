"use client";
import { useEffect } from "react";

export default function ExtensionErrorHandler() {
  useEffect(() => {
    const handleUnhandledRejection = (event) => {
      // Prevent MetaMask and other browser extension errors from showing the Next.js error overlay
      if (
        event.reason && 
        (event.reason.message?.includes("MetaMask") || 
         event.reason.message?.includes("extension"))
      ) {
        event.preventDefault();
      }
    };
    
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  }, []);

  return null;
}
