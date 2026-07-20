export default function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-black/[0.07] dark:bg-white/[0.09] ${className}`}
    />
  );
}
