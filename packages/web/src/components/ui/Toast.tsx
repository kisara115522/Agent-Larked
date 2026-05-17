import { useEffect, useState, useCallback, createContext, useContext } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'error' | 'success' | 'info';
}

interface ToastContextValue {
  toast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: Toast['type'] = 'error') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-2.5 rounded-lg text-[13px] font-medium shadow-lg animate-[fadeUp_.15s] ${
              t.type === 'error' ? 'bg-error text-white' :
              t.type === 'success' ? 'bg-[#064E3B] text-[#34D399]' :
              'bg-surface-elevated text-text border border-border'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
