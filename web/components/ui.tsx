"use client";
import Image from "next/image";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Logo({ size = 64, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt="RIVR Health"
      width={size}
      height={size}
      priority
      className={`mx-auto block rounded-[28%] shadow-sm ${className}`}
    />
  );
}

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded-lg bg-teal px-4 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 outline-none transition focus:border-teal ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-sub">{label}</span>
      {children}
    </label>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="text-sm text-red-600">{children}</p> : null;
}

export function CtaLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="block rounded-lg bg-teal px-4 py-2.5 font-semibold text-white transition hover:opacity-90"
    >
      {children}
    </a>
  );
}
