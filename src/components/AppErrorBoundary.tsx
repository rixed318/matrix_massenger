import React, { ErrorInfo, ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

const monitorUrl = import.meta.env.VITE_ERROR_MONITOR_URL;

const reportErrorToMonitoring = (error: Error, errorInfo: ErrorInfo) => {
  try {
    if (monitorUrl && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      const payload = JSON.stringify({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
      });
      navigator.sendBeacon(monitorUrl, payload);
    }
  } catch (monitorError) {
    console.warn('AppErrorBoundary: monitoring reporting failed', monitorError);
  }
};

class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    error: undefined,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('AppErrorBoundary caught an error', error, errorInfo);
    reportErrorToMonitoring(error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    if (this.props.onReset) {
      try {
        this.props.onReset();
        return;
      } catch (resetError) {
        console.warn('AppErrorBoundary onReset handler threw', resetError);
      }
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full p-6 text-center bg-bg-secondary text-text-primary">
          <div className="max-w-md space-y-4">
            <h1 className="text-2xl font-semibold">
              {this.props.fallbackTitle || 'Что-то пошло не так'}
            </h1>
            <p className="text-sm text-text-secondary">
              {this.props.fallbackMessage || 'Произошла непредвиденная ошибка. Попробуйте перезапустить приложение.'}
            </p>
            {this.state.error?.message && (
              <pre className="text-xs bg-bg-tertiary text-left p-3 rounded-md overflow-auto max-h-40">
                {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="px-4 py-2 rounded-md bg-primary text-white hover:bg-primary/90 transition"
            >
              Перезапустить
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default AppErrorBoundary;
