import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useRef } from 'react';
import Wrapper from 'components/molecules/Wrapper/Wrapper';
import Header from 'components/organisms/Header/Header';
import Footer from 'components/organisms/Footer/Footer';
import Main from 'components/organisms/Main/Main';
import { BtnSimple } from 'getbasecore/Atoms';
import './SyncthingCloudSyncPage.scss';

function CloudSyncPage() {
  const { t } = useTranslation();
  const ipcChannel = window.electron.ipcRenderer;

  const [syncthingStatus, setSyncthingStatus] = useState('loading');
  const [deviceId, setDeviceId] = useState('');
  const [peers, setPeers] = useState([]);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [pairCode, setPairCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [codeMode, setCodeMode] = useState('idle');
  const [codeStatus, setCodeStatus] = useState('');
  const [installing, setInstalling] = useState(false);
  const [folderStats, setFolderStats] = useState(null);
  const [completions, setCompletions] = useState({});
  const pollRef = useRef(null);
  const statusCheckDoneRef = useRef(false);

  useEffect(() => {
    checkStatus();
    return () => {
      ipcChannel.sendMessage('syncthing-discover-stop');
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    ipcChannel.on('syncthing-peer-found', (data) => {
      setPeers((prev) => {
        const exists = prev.find((p) => p.deviceId === data.deviceId);
        if (exists) return prev;
        return [...prev, data];
      });
    });
    ipcChannel.on('syncthing-code-created', (data) => {
      if (data.paired) {
        setCodeStatus('Paired! Connecting...');
        pairWithDevice(data.peerDeviceId, data.peerHostname || 'Remote Peer');
        setCodeMode('idle');
      } else if (data.code) {
        setPairCode(data.code);
        setCodeStatus('Waiting for peer to enter code...');
      } else if (data.error) {
        setCodeStatus('Error: ' + data.error);
        setCodeMode('idle');
      } else if (data.timeout) {
        setCodeStatus('Timed out waiting for peer');
        setCodeMode('idle');
        setPairCode('');
      }
    });
    ipcChannel.on('syncthing-code-joined', (data) => {
      if (data.peerDeviceId) {
        setCodeStatus('Found peer! Connecting...');
        pairWithDevice(data.peerDeviceId, data.peerHostname || 'Remote Peer');
        setCodeMode('idle');
      } else if (data.error) {
        setCodeStatus('Error: ' + data.error);
        setCodeMode('idle');
      }
    });
  }, []);

  function checkStatus() {
    setSyncthingStatus('loading');
    ipcChannel.sendMessage('emudeck', ['syncthing_stat|||syncthing_status']);
    ipcChannel.once('syncthing_stat', (result) => {
      const stdout = result && result.stdout ? result.stdout.trim() : '';
      if (stdout && stdout !== 'stopped' && stdout !== '') {
        setSyncthingStatus('running');
        setDeviceId(stdout);
        if (!statusCheckDoneRef.current) {
          statusCheckDoneRef.current = true;
          setTimeout(() => {
            startDiscovery(stdout);
            startPolling();
          }, 500);
        }
      } else {
        setSyncthingStatus('stopped');
        setDeviceId('');
      }
    });
  }

  function startDiscovery(myId) {
    ipcChannel.sendMessage('syncthing-discover-start', [myId]);
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(pollAll, 8000);
    pollAll();
  }

  function pollAll() {
    pollConnections();
    pollFolderStats();
  }

  function pollConnections() {
    ipcChannel.sendMessage('emudeck', ['syncthing_conn|||syncthing_get_connections']);
    ipcChannel.once('syncthing_conn', (result) => {
      if (result && result.stdout && result.stdout !== '{}') {
        try {
          const conn = JSON.parse(result.stdout);
          const devices = conn.connections || {};
          const paired = Object.keys(devices).map((id) => ({
            deviceId: id,
            name: devices[id].name || id,
            connected: devices[id].connected,
            paused: devices[id].paused,
            address: devices[id].address,
            inBytesTotal: devices[id].inBytesTotal || 0,
            outBytesTotal: devices[id].outBytesTotal || 0,
          }));
          setPairedDevices(paired);
          paired.forEach((d) => pollCompletion(d.deviceId));
        } catch (_) {}
      }
    });
  }

  function pollFolderStats() {
    ipcChannel.sendMessage('emudeck', ['syncthing_fstats|||syncthing_get_folder_status']);
    ipcChannel.once('syncthing_fstats', (result) => {
      if (result && result.stdout && result.stdout !== '{}') {
        try {
          setFolderStats(JSON.parse(result.stdout));
        } catch (_) {}
      }
    });
  }

  function pollCompletion(devId) {
    ipcChannel.sendMessage('emudeck', [
      'syncthing_cpl_' + devId.substring(0, 7) + '|||syncthing_get_completion ' + devId,
    ]);
    ipcChannel.once('syncthing_cpl_' + devId.substring(0, 7), (result) => {
      if (result && result.stdout && result.stdout !== '{}') {
        try {
          const data = JSON.parse(result.stdout);
          setCompletions((prev) => ({
            ...prev,
            [devId]: data.completion || 0,
          }));
        } catch (_) {}
      }
    });
  }

  function installSyncthing() {
    setInstalling(true);
    ipcChannel.sendMessage('emudeck', ['syncthing_install|||syncthing_install']);
    ipcChannel.once('syncthing_install', (result) => {
      setInstalling(false);
      if (result && result.stdout) {
        startSyncthing();
      }
    });
  }

  function startSyncthing() {
    setSyncthingStatus('loading');
    ipcChannel.sendMessage('emudeck', ['syncthing_start|||syncthing_start']);
    ipcChannel.once('syncthing_start', () => {
      checkStatus();
    });
  }

  function stopSyncthing() {
    setSyncthingStatus('loading');
    ipcChannel.sendMessage('emudeck', ['syncthing_stop|||syncthing_stop']);
    ipcChannel.once('syncthing_stop', () => {
      setSyncthingStatus('stopped');
      setDeviceId('');
      ipcChannel.sendMessage('syncthing-discover-stop');
      if (pollRef.current) clearInterval(pollRef.current);
    });
  }

  function getPairingCode() {
    setCodeMode('hosting');
    setCodeStatus('Generating code...');
    ipcChannel.sendMessage('syncthing-create-code', [deviceId]);
  }

  function joinWithCode() {
    if (!codeInput.trim()) return;
    const code = codeInput.trim();
    setCodeMode('joining');
    setCodeStatus('Looking up code...');
    ipcChannel.sendMessage('syncthing-join-code', [code, deviceId]);
  }

  function cancelCode() {
    if (pairCode) {
      ipcChannel.sendMessage('syncthing-cancel-code', [pairCode]);
    }
    setCodeMode('idle');
    setCodeStatus('');
    setPairCode('');
  }

  function pairLocalPeer(peer) {
    pairWithDevice(peer.deviceId, peer.hostname || 'LAN Peer');
  }

  function pairWithDevice(targetDeviceId, name) {
    ipcChannel.sendMessage('emudeck', [
      'syncthing_pair_back|||syncthing_pair ' + targetDeviceId + ' "' + name + '"',
    ]);
    ipcChannel.once('syncthing_pair_back', (result) => {
      if (result && result.error) {
        setCodeStatus('Pairing failed: ' + result.error);
      } else {
        setCodeStatus('Paired successfully!');
        setTimeout(pollAll, 1000);
      }
    });
  }

  function unpairDevice(devId) {
    ipcChannel.sendMessage('emudeck', ['syncthing_unpair|||syncthing_unpair ' + devId]);
    ipcChannel.once('syncthing_unpair', () => {
      setPairedDevices((prev) => prev.filter((d) => d.deviceId !== devId));
    });
  }

  const isRunning = syncthingStatus === 'running';
  const isLoading = syncthingStatus === 'loading';
  const connectedCount = pairedDevices.filter((d) => d.connected).length;
  const fileCount = folderStats ? folderStats.globalFiles || 0 : 0;
  const fileBytes = folderStats ? folderStats.globalBytes || 0 : 0;

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i++;
    }
    return val.toFixed(1) + ' ' + units[i];
  }

  function truncateDeviceId(id) {
    if (!id || id.length < 20) return id || '';
    return id.substring(0, 7) + '...' + id.substring(id.length - 7);
  }

  return (
    <Wrapper>
      <Header title="P2P Cloud Sync" />
      <p className="lead">
        Sync your saves directly between devices. Fully peer-to-peer — no server, no account needed.
      </p>
      <Main>
        <div className="syncthing-page">
          <div className="syncthing-banner">
            <div className="syncthing-banner__info">
              <div className="syncthing-banner__title">
                {isLoading ? (
                  <div className="syncthing-code-status__spinner" />
                ) : (
                  <span
                    className={
                      'syncthing-banner__dot syncthing-banner__dot--' +
                      (isRunning ? 'running' : 'stopped')
                    }
                  />
                )}
                <span className="syncthing-banner__label">
                  {isLoading ? 'Checking...' : isRunning ? 'Running' : 'Stopped'}
                </span>
              </div>
              {deviceId && (
                <span className="syncthing-banner__id">
                  Device ID: {deviceId}
                </span>
              )}
            </div>
            <div className="syncthing-banner__actions">
              {isLoading ? (
                <BtnSimple css="btn-simple--4" disabled>...</BtnSimple>
              ) : isRunning ? (
                <BtnSimple css="btn-simple--2" onClick={stopSyncthing}>
                  Stop
                </BtnSimple>
              ) : (
                <BtnSimple
                  css="btn-simple--1"
                  onClick={installSyncthing}
                  disabled={installing}
                >
                  {installing ? 'Installing...' : 'Install & Start'}
                </BtnSimple>
              )}
            </div>
          </div>

          <div className="syncthing-pairing-grid">
            <div className="syncthing-card">
              <div className="syncthing-card__header">
                <div className="syncthing-card__icon syncthing-card__icon--lan">
                  &#x1F4E1;
                </div>
                <span className="syncthing-card__title">Local Network</span>
              </div>
              <p className="syncthing-card__desc">
                Devices discovered automatically on your local network.
              </p>
              <div className="syncthing-card__body">
                {!isRunning ? (
                  <div className="syncthing-empty">
                    <div className="syncthing-empty__icon">&#x1F4E1;</div>
                    <div className="syncthing-empty__text">
                      Start Syncthing above to discover peers on your LAN
                    </div>
                  </div>
                ) : peers.length === 0 ? (
                  <div className="syncthing-scanning">
                    <div className="syncthing-scanning__dots">
                      <span className="syncthing-scanning__dot" />
                      <span className="syncthing-scanning__dot" />
                      <span className="syncthing-scanning__dot" />
                    </div>
                    Scanning for nearby devices...
                  </div>
                ) : (
                  <div className="syncthing-peer-list">
                    {peers.map((peer, i) => (
                      <div key={i} className="syncthing-peer-item">
                        <div className="syncthing-peer-item__icon">&#x1F5B5;</div>
                        <div className="syncthing-peer-item__info">
                          <span className="syncthing-peer-item__name">
                            {peer.hostname || 'Unknown Device'}
                          </span>
                          <span className="syncthing-peer-item__addr">
                            {peer.address}
                          </span>
                        </div>
                        <div className="syncthing-peer-item__action">
                          <BtnSimple css="btn-simple--4" onClick={() => pairLocalPeer(peer)}>
                            Pair
                          </BtnSimple>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="syncthing-card">
              <div className="syncthing-card__header">
                <div className="syncthing-card__icon syncthing-card__icon--code">
                  &#x1F517;
                </div>
                <span className="syncthing-card__title">Remote Pairing</span>
              </div>
              <p className="syncthing-card__desc">
                Share a short code to pair with a device anywhere on the internet.
              </p>
              <div className="syncthing-card__body">
                {!isRunning ? (
                  <div className="syncthing-empty">
                    <div className="syncthing-empty__icon">&#x1F517;</div>
                    <div className="syncthing-empty__text">
                      Start Syncthing above to use code pairing
                    </div>
                  </div>
                ) : codeMode === 'idle' ? (
                  <div className="syncthing-code-area">
                    <div className="syncthing-code-actions">
                      <BtnSimple css="btn-simple--1" onClick={getPairingCode}>
                        Get a Code
                      </BtnSimple>
                      <span className="syncthing-code-divider">or</span>
                      <BtnSimple css="btn-simple--1" onClick={joinWithCode}>
                        Enter Code
                      </BtnSimple>
                    </div>
                    <div className="syncthing-code-input-row">
                      <input
                        className="syncthing-code-input"
                        type="text"
                        placeholder="e.g. XKV-382"
                        value={codeInput}
                        onChange={(e) => setCodeInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && joinWithCode()}
                      />
                      <BtnSimple css="btn-simple--4" onClick={joinWithCode}>
                        Connect
                      </BtnSimple>
                    </div>
                  </div>
                ) : (
                  <div className="syncthing-code-area">
                    {pairCode && (
                      <div className="syncthing-code-display">
                        <div className="syncthing-code-display__code">
                          {pairCode}
                        </div>
                        <div className="syncthing-code-display__label">
                          Share this code with the other device
                        </div>
                      </div>
                    )}
                    <div className="syncthing-code-status">
                      <div className="syncthing-code-status__spinner" />
                      <span>{codeStatus}</span>
                    </div>
                    <BtnSimple css="btn-simple--2" onClick={cancelCode}>
                      Cancel
                    </BtnSimple>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="syncthing-card">
            <div className="syncthing-card__header">
              <span className="syncthing-card__title">Connected Devices</span>
              <span
                style={{
                  fontSize: '1.1rem',
                  color: 'var(--color-text-2)',
                  marginLeft: 'auto',
                }}
              >
                {connectedCount} online / {pairedDevices.length - connectedCount} offline
              </span>
            </div>
            <div className="syncthing-card__body">
              {!isRunning ? (
                <div className="syncthing-empty">
                  <div className="syncthing-empty__icon">&#x1F310;</div>
                  <div className="syncthing-empty__text">
                    Start Syncthing above to see connected devices
                  </div>
                </div>
              ) : pairedDevices.length === 0 ? (
                <div className="syncthing-empty">
                  <div className="syncthing-empty__icon">&#x1F5C4;</div>
                  <div className="syncthing-empty__text">
                    No devices paired yet. Use Local Network or Remote Pairing above.
                  </div>
                </div>
              ) : (
                <div className="syncthing-device-table">
                  {pairedDevices.map((dev, i) => (
                    <div key={i} className="syncthing-device-row">
                      <span
                        className={
                          'syncthing-device-row__dot syncthing-device-row__dot--' +
                          (dev.connected ? 'online' : 'offline')
                        }
                      />
                      <div className="syncthing-device-row__info">
                        <span className="syncthing-device-row__name">{dev.name}</span>
                        <div className="syncthing-device-row__meta">
                          <span>{truncateDeviceId(dev.deviceId)}</span>
                          <span>&#8593; {formatBytes(dev.outBytesTotal)}</span>
                          <span>&#8595; {formatBytes(dev.inBytesTotal)}</span>
                        </div>
                      </div>
                      <div className="syncthing-device-row__progress-wrap">
                        <div className="syncthing-device-row__progress">
                          <div
                            className="syncthing-device-row__progress-fill"
                            style={{
                              width: (completions[dev.deviceId] || 0) + '%',
                            }}
                          />
                        </div>
                        <div className="syncthing-device-row__progress-text">
                          {completions[dev.deviceId] !== undefined
                            ? Math.round(completions[dev.deviceId]) + '%'
                            : '--'}
                        </div>
                      </div>
                      <div className="syncthing-device-row__actions">
                        <BtnSimple css="btn-simple--3" onClick={() => unpairDevice(dev.deviceId)}>
                          Unpair
                        </BtnSimple>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="syncthing-card">
            <div className="syncthing-card__header">
              <span className="syncthing-card__title">Sync Overview</span>
            </div>
            <div className="syncthing-card__body">
              <div className="syncthing-stats">
                <div className="syncthing-stat">
                  <div className="syncthing-stat__value">{fileCount}</div>
                  <div className="syncthing-stat__label">Total Files</div>
                </div>
                <div className="syncthing-stat">
                  <div className="syncthing-stat__value">{formatBytes(fileBytes)}</div>
                  <div className="syncthing-stat__label">Total Size</div>
                </div>
                <div className="syncthing-stat">
                  <div className="syncthing-stat__value">{pairedDevices.length}</div>
                  <div className="syncthing-stat__label">Paired Devices</div>
                </div>
                <div className="syncthing-stat">
                  <div className="syncthing-stat__value">{connectedCount}</div>
                  <div className="syncthing-stat__label">Online</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Main>
      <Footer />
    </Wrapper>
  );
}

export default CloudSyncPage;
