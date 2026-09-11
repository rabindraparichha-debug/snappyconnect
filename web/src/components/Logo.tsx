export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <img src="/logo.png" alt="SnappyHires" className="h-7 w-auto" />
      <span className={`text-base font-bold tracking-tight ${light ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
        Snappy<span className="text-brand-500">Connect</span>
      </span>
    </div>
  );
}
