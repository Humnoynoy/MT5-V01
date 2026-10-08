import React, { useState } from 'react';
import { X, KeyRound } from 'lucide-react';

interface ConnectAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectAccount: (payload: {
    login: number;
    password?: string;
    passwordType?: 'Investor (Read-Only)' | 'Master (Full Execution)';
    server: string;
    name?: string;
    initialDeposit?: number;
    leverage?: number;
    seedSampleData?: boolean;
  }) => void;
}

const PRESET_SERVERS = [
  'VantageMarkets-Live 21',
  'MetaQuotes-Demo',
  'ICMarketsSC-MT5-4',
  'Pepperstone-MT5-Live02',
  'FTMO-Server3',
  'Exness-MT5Real',
  'OANDA-MT5-Live',
  'VantageInternational-Live',
  
];

export const ConnectAccountModal: React.FC<ConnectAccountModalProps> = ({
  isOpen,
  onClose,
  onConnectAccount,
}) => {
  const [login, setLogin] = useState<string>('24673550');
  const [password, setPassword] = useState<string>('56241445K@k');
  const [savePassword, setSavePassword] = useState<boolean>(true);
  const [server, setServer] = useState<string>('MetaQuotes-Demo');
  const [customServer, setCustomServer] = useState<string>('');
  const [accountName, setAccountName] = useState<string>('');

  if (!isOpen) return null;

  const resolvedServer = server === 'CUSTOM' ? customServer.trim() || 'MetaQuotes-Demo' : server;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numericLogin = parseInt(login.replace(/\D/g, ''), 10);
    if (!numericLogin) return;
    onConnectAccount({
      login: numericLogin,
      password,
      passwordType: 'Investor (Read-Only)',
      server: resolvedServer,
      name: accountName.trim() || `${resolvedServer} #${numericLogin}`,
      initialDeposit: 0,
      leverage: 100,
      seedSampleData: false,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-lg border border-[#1E293B] bg-[#111827] p-6">
        <div className="flex items-center justify-between pb-4 border-b border-[#1E293B]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center rounded">
              <KeyRound className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Login to Trade Account (MT5 Authorization)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Register your real MT5 Account Login & Server — Balance, Open Orders & History sync from MT5
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 transition-colors"
            aria-label="Close Login Window"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-12 items-center gap-2 sm:gap-4">
            <label htmlFor="mt5-login-input" className="sm:col-span-3 text-xs text-slate-300 sm:text-right">
              MT5 Login:
            </label>
            <div className="sm:col-span-9">
              <input
                id="mt5-login-input"
                type="text"
                required
                autoFocus
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="Enter your real MT5 Account Login number"
                className="w-full px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 items-center gap-2 sm:gap-4">
            <label htmlFor="mt5-password-input" className="sm:col-span-3 text-xs text-slate-300 sm:text-right">
              Password:
            </label>
            <div className="sm:col-span-9 flex items-center gap-3">
              <input
                id="mt5-password-input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Investor or Master password"
                className="flex-1 px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
              />
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 whitespace-nowrap cursor-pointer">
                <input
                  type="checkbox"
                  checked={savePassword}
                  onChange={(e) => setSavePassword(e.target.checked)}
                  className="accent-blue-600"
                />
                Save password
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 items-center gap-2 sm:gap-4">
            <label htmlFor="mt5-server-select" className="sm:col-span-3 text-xs text-slate-300 sm:text-right">
              Server:
            </label>
            <div className="sm:col-span-9 space-y-2">
              <select
                id="mt5-server-select"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
              >
                {PRESET_SERVERS.map((srv) => (
                  <option key={srv} value={srv}>
                    {srv}
                  </option>
                ))}
                <option value="CUSTOM">Custom Broker Server...</option>
              </select>
              {server === 'CUSTOM' && (
                <input
                  type="text"
                  value={customServer}
                  onChange={(e) => setCustomServer(e.target.value)}
                  placeholder="Enter exact MT5 server name"
                  className="w-full px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 items-center gap-2 sm:gap-4">
            <label htmlFor="mt5-label-input" className="sm:col-span-3 text-xs text-slate-300 sm:text-right">
              Label (Optional):
            </label>
            <div className="sm:col-span-9">
              <input
                id="mt5-label-input"
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Optional display name"
                className="w-full px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="p-3 bg-[#0B0F17] border border-[#1E293B] space-y-1.5">
            <div className="text-xs text-emerald-400 font-medium">
              100% Real MT5 Data Only (No Simulated Balance or Demo Orders)
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Your account starts clean (`$0.00` balance, `0` open orders, `0` history orders). Attach <span className="font-mono text-slate-300">MetaPulseSyncEA.mq5</span> in MetaTrader 5 to stream your real balance, real open positions, and real trade history.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#1E293B]">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-xs font-medium text-slate-300 bg-[#0B0F17] border border-[#1E293B] hover:bg-[#1E293B] rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
            >
              OK — Connect Account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
