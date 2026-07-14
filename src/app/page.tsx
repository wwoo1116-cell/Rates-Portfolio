"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormGroup, InputGroup, Intent } from "@blueprintjs/core";
import { useAuthStore } from "@/stores/auth-store";

export default function RootPage() {
  const router = useRouter();
  const [view, setView] = useState<"splash" | "login" | "signup">("splash");

  // Splash 씬 이후 로그인 폼으로 전환 (3.5초)
  useEffect(() => {
    if (view === "splash") {
      const timer = setTimeout(() => {
        setView("login");
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [view]);

  const login = useAuthStore((s) => s.login);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // 임시 로그인 처리 후 데이터 업로드 화면으로 이동 (대시보드 진입 전 필수 단계)
    login();
    router.push("/upload");
  };

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    // 임시 회원가입 처리 후 다시 로그인 화면으로
    setView("login");
  };

  return (
    <div className="relative flex flex-col items-center justify-center w-full h-screen bg-[#10161A] overflow-hidden">
      <style>{`
        @keyframes imageReveal {
          0% {
            opacity: 0;
            transform: translateY(40px) scale(0.98);
            filter: grayscale(80%) brightness(30%) blur(15px);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: grayscale(80%) brightness(30%) blur(0px);
          }
        }

        @keyframes textFadeIn {
          0% {
            opacity: 0;
            transform: translateY(12px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-image-reveal {
          animation: imageReveal 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .animate-text-reveal {
          opacity: 0;
          animation: textFadeIn 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: 0.5s;
        }

        .animate-form-reveal {
          opacity: 0;
          animation: textFadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      {/* Background Image Container */}
      <div
        className={`absolute inset-0 w-full h-full bg-top bg-no-repeat bg-cover ${view === 'splash' ? 'animate-image-reveal' : ''}`}
        style={{
          backgroundImage: "url('/Mirae_Asset_Center1.png')",
          // 로그인 화면 전환 시 배경을 살짝 더 흐리게 하여 폼 가독성 극대화
          filter: view === 'splash' ? "grayscale(80%) brightness(30%)" : "grayscale(80%) brightness(20%) blur(8px)",
          transition: "filter 1.2s ease-out"
        }}
      />

      {/* 1. Splash Screen Content */}
      {view === "splash" && (
        <div className="relative z-10 flex flex-col items-center text-center animate-text-reveal">
          <h1
            className="text-white font-extrabold tracking-tight"
            style={{
              fontFamily: "var(--font-ui), 'Inter', sans-serif",
              fontSize: "clamp(2.5rem, 5vw, 4.5rem)",
              lineHeight: 1.1
            }}
          >
            Project Future
          </h1>
          <p
            className="text-white/70 font-medium mt-4 uppercase"
            style={{
              fontFamily: "var(--font-ui), 'Inter', sans-serif",
              fontSize: "clamp(0.875rem, 2vw, 1rem)",
              letterSpacing: "0.15em"
            }}
          >
            Portfolio Management System
          </p>
        </div>
      )}

      {/* 2. Auth Container (Login / Signup) */}
      {view !== "splash" && (
        <div className="relative z-10 flex flex-col items-center w-full max-w-sm animate-form-reveal">
          <div className="mb-8 text-center">
            <h1 className="text-white font-extrabold tracking-tight text-3xl" style={{ fontFamily: "var(--font-ui), 'Inter', sans-serif" }}>
              Project Future
            </h1>
          </div>

          <div
            className="w-full p-8"
            style={{
              backgroundColor: "var(--bg-surface)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "0px" // 기관용 UI: No rounded edges
            }}
          >
            {view === "login" ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-white mb-4">Sign In</h2>

                <FormGroup label="Username ID" labelFor="username">
                  <InputGroup id="username" placeholder="Enter your ID" fill large />
                </FormGroup>

                <FormGroup label="Password" labelFor="password">
                  <InputGroup id="password" type="password" placeholder="Enter your password" fill large />
                </FormGroup>

                <Button
                  type="submit"
                  intent={Intent.PRIMARY}
                  fill
                  large
                  className="mt-6"
                >
                  Log In
                </Button>

                <div className="mt-6 text-center text-sm text-[var(--fg-muted)]">
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setView("signup")}
                    className="text-[var(--chart-ocean)] hover:text-[var(--chart-aqua)] transition-colors font-medium"
                  >
                    Register here
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSignup} className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-white mb-4">Register Account</h2>

                <FormGroup label="Username ID" labelFor="reg-username">
                  <InputGroup id="reg-username" placeholder="Choose an ID" fill large />
                </FormGroup>

                <FormGroup label="Password" labelFor="reg-password">
                  <InputGroup id="reg-password" type="password" placeholder="Choose a password" fill large />
                </FormGroup>

                <FormGroup label="Confirm Password" labelFor="reg-password-confirm">
                  <InputGroup id="reg-password-confirm" type="password" placeholder="Re-enter password" fill large />
                </FormGroup>

                <Button
                  type="submit"
                  intent={Intent.PRIMARY}
                  fill
                  large
                  className="mt-6"
                >
                  Create Account
                </Button>

                <div className="mt-6 text-center text-sm text-[var(--fg-muted)]">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setView("login")}
                    className="text-[var(--chart-ocean)] hover:text-[var(--chart-aqua)] transition-colors font-medium"
                  >
                    Log In
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
