import { getIntl } from '@umijs/max';
import { Alert } from 'antd';
import { useSyncExternalStore } from 'react';

const subscribeOnlineStatus = (callback: () => void) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};

const getOnlineStatus = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine;

const OfflineBanner: React.FC = () => {
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineStatus,
    () => true,
  );

  if (isOnline) return null;

  return (
    <Alert
      type="warning"
      showIcon
      closable={false}
      className="academy-offline-banner"
      title={getIntl().formatMessage({
        id: 'app.network.offline',
        defaultMessage:
          'You are currently offline. Some features may be unavailable.',
      })}
    />
  );
};

export default OfflineBanner;
