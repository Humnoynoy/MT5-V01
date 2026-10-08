import React, { useState } from 'react';
import { Lock, User, ShieldCheck, AlertCircle } from 'lucide-react';

interface UserLoginScreenProps {
  onAuthenticated: (username: string) => void;
}

const VALID_USERS: Record<string, string> = {
  Sosaka: 'Ominisato',
  Sosaka1: 'Ominisato1',
};

export const UserLoginScreen: React.FC<UserLoginScreenProps> = ({ onAuthenticated }) => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUser = username.trim();
    const matchedUserKey = Object.keys(VALID_USERS).find(
      (k) => k.toLowerCase() === trimmedUser.toLowerCase()
    );

    if (matchedUserKey && VALID_USERS[matchedUserKey] === password) {
      onAuthenticated(matchedUserKey);
    } else {
      setError('Invalid User ID or Password. Authorized users: Sosaka, Sosaka1');
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col justify-between p-6">
      <header className="flex items-center justify-between max-w-[1440px] w-full mx-auto py-2 border-b border-[#1E293B]">
        <span className="text-lg font-bold tracking-tight text-slate-100">MetaPulse MT5</span>
        <span className="text-xs font-mono text-slate-400">
          Private Owner Telemetry & RSI Grid Terminal
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center py-12">
        <div className="w-full max-w-md border border-[#1E293B] bg-[#111827] p-7 space-y-6">
          <div className="space-y-1.5 border-b border-[#1E293B] pb-4">
            <div className="inline-flex items-center gap-2 text-xs font-mono text-blue-400">
              <ShieldCheck className="w-4 h-4" />
              <span>OWNER-SCOPED ACCESS CONTROL</span>
            </div>
            <h1 className="text-xl font-semibold text-slate-100 tracking-tight">
              Sign In to MetaPulse MT5
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Sign in with your Owner User ID to access your isolated MT5 trade accounts, open positions, deal history, and RSI Grid orders.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-300 mb-1.5 font-medium">
                User ID (Owner)
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Sosaka"
                  className="w-full pl-9 pr-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5 font-medium">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="•••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors rounded"
              >
                Sign In as Owner
              </button>
            </div>
          </form>

          <div className="pt-3 border-t border-[#1E293B] text-[11px] text-slate-400 space-y-1 font-mono">
            <div>Isolation Policy: Strict Owner User ID Filtering</div>
            <div className="text-slate-500">
              Only open orders, deal ledger history, and MT5 accounts belonging to your User ID are visible.
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-500 font-mono py-2">
        MetaPulse MT5 · Real-Time WebSocket Synchronization
      </footer>
    </div>
  );
};
