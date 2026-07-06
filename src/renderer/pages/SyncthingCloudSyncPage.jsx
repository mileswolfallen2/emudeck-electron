import { useTranslation } from 'react-i18next';
import React, { useState, useContext, useEffect, useRef } from 'react';
import { GlobalContext } from 'context/globalContext';
import Wrapper from 'components/molecules/Wrapper/Wrapper';
import Header from 'components/organisms/Header/Header';
import Footer from 'components/organisms/Footer/Footer';
import Main from 'components/organisms/Main/Main';
import { BtnSimple } from 'getbasecore/Atoms';

function SyncthingCloudSyncPage() {
  const { t } = useTranslation();
  const { state, setState } = useContext(GlobalContext);
  const ipcChannel = window.electron.ipcRenderer;

  const [syncthingStatus, setSyncthingStatus] = useState('stopped');
  const [deviceId, setDeviceId] = useState('');
  const [peers, setPeers] = useState([]);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [pairCode, setPairCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [codeMode, setCodeMode] = useState('idle');
  const [codeStatus, setCodeStatus] = useState('');
  const [installing, setInstalling] = useState(false);
  const [syncProgress, setSyncProgress] = useState({});
  const pollRef = useRef(null);

  useEffect(() => {
    getDeviceId();
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
        pairWithDevice(data.peerDeviceId, data.peerHostname || 'DHT Peer');
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
      }
    });
    ipcChannel.on('syncthing-code-joined', (data) => {
      if (data.peerDeviceId) {
        setCodeStatus('Found peer! Connecting...');
        pairWithDevice(data.peerDeviceId, data.peerHostname || 'DHT Peer');
        setCodeMode('idle');
      } else if (data.error) {
        setCodeStatus('Error: ' + data.error);
        setCodeMode('idle');
      }
    });
    return () => {
      // Cleanup listeners is tricky with the current preload - we'll skip for now
    };
  }, []);

  function getDeviceId() {
    ipcChannel.sendMessage('emudeck', ['syncthing_get_id|||syncthing_get_device_id']);
    ipcChannel.once('syncthing_get_id', (result) => {
      if (result && result.stdout && result.stdout.trim()) {
        setDeviceId(result.stdout.trim());
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
    ipcChannel.sendMessage('emudeck', ['syncthing_start|||syncthing_start']);
    ipcChannel.once('syncthing_start', (result) => {
      setSyncthingStatus('running');
      // Get device ID, then start LAN discovery and polling
      ipcChannel.sendMessage('emudeck', ['syncthing_get_id|||syncthing_get_device_id']);
      ipcChannel.once('syncthing_get_id', (result) => {
        if (result && result.stdout && result.stdout.trim()) {
          const id = result.stdout.trim();
          setDeviceId(id);
          ipcChannel.sendMessage('syncthing-discover-start', [id]);
        } else {
          ipcChannel.sendMessage('syncthing-discover-start', ['']);
        }
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(pollStatus, 10000);
      });
    });
  }

  function stopSyncthing() {
    ipcChannel.sendMessage('emudeck', ['syncthing_stop|||syncthing_stop']);
    ipcChannel.once('syncthing_stop', () => {
      setSyncthingStatus('stopped');
      ipcChannel.sendMessage('syncthing-discover-stop');
      if (pollRef.current) clearInterval(pollRef.current);
    });
  }

  function pollStatus() {
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
          }));
          setPairedDevices(paired);
        } catch (_) {}
      }
    });
  }

  function getPairingCode() {
    setCodeMode('hosting');
    setCodeStatus('Generating code...');
    ipcChannel.sendMessage('syncthing-create-code', [deviceId]);
  }

  function joinWithCode() {
    if (!codeInput.trim()) return;
    const code = codeInput.trim().toUpperCase();
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

  function pairWithDevice(targetDeviceId, name) {
    ipcChannel.sendMessage('emudeck', [
      `syncthing_pair_back|||syncthing_pair ${targetDeviceId} "${name}"`,
    ]);
    ipcChannel.once('syncthing_pair_back', (result) => {
      if (result && result.error) {
        setCodeStatus('Pairing failed: ' + result.error);
      } else {
        setCodeStatus('Paired successfully!');
        pollStatus();
      }
    });
  }

  function pairLocalPeer(peer) {
    pairWithDevice(peer.deviceId, peer.hostname || 'LAN Peer');
  }

  function unpairDevice(deviceId) {
    ipcChannel.sendMessage('emudeck', ['syncthing_unpair|||syncthing_unpair ' + deviceId]);
    ipcChannel.once('syncthing_unpair', () => {
      pollStatus();
    });
  }

  const statusColor = syncthingStatus === 'running' ? '#4caf50' : '#f44336';
  const statusText = syncthingStatus === 'running' ? 'Running' : 'Stopped';

  return (
    <Wrapper>
      <Header title="Syncthing Cloud Sync" />
      <Main>
        {/* Status section */}
        <div style={sectionStyle}>
          <h3>Syncthing Status</h3>
          <p>
            <span style={{ color: statusColor, fontWeight: 'bold', fontSize: '1.2em' }}>●</span>{' '}
            {statusText}
          </p>
          {deviceId && (
            <p style={{ fontSize: '0.85em', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              Device ID: {deviceId}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {syncthingStatus === 'stopped' && (
              <BtnSimple css="btn--small" onClick={installSyncthing} disabled={installing}>
                {installing ? 'Installing...' : 'Install & Start'}
              </BtnSimple>
            )}
            {syncthingStatus === 'running' && (
              <BtnSimple css="btn--small" onClick={stopSyncthing}>Stop</BtnSimple>
            )}
          </div>
        </div>

        {/* LAN Peers */}
        <div style={sectionStyle}>
          <h3>Local Network Peers</h3>
          {syncthingStatus === 'running' ? (
            peers.length === 0 ? (
              <p style={{ color: '#888' }}>Scanning for peers on LAN...</p>
            ) : (
              peers.map((peer, i) => (
                <div key={i} style={peerRowStyle}>
                  <span>{peer.hostname || peer.address}</span>
                  <span style={{ fontSize: '0.8em', color: '#888' }}>{peer.address}</span>
                  <BtnSimple css="btn--small" onClick={() => pairLocalPeer(peer)}>
                    Pair
                  </BtnSimple>
                </div>
              ))
            )
          ) : (
            <p style={{ color: '#888' }}>Start Syncthing to discover peers</p>
          )}
        </div>

        {/* Code Pairing */}
        <div style={sectionStyle}>
          <h3>Internet Pairing (Fallback)</h3>
          {codeMode === 'idle' && syncthingStatus === 'running' && (
            <div>
              <div style={{ marginBottom: 12 }}>
                <BtnSimple css="btn--small" onClick={getPairingCode}>
                  Get a Code
                </BtnSimple>
                <span style={{ margin: '0 12px', color: '#888' }}>OR</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Enter code (e.g. FOX-721)"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 4,
                    border: '1px solid #555',
                    background: '#2a2a2a',
                    color: '#fff',
                    fontFamily: 'monospace',
                    fontSize: '1em',
                    flex: 1,
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && joinWithCode()}
                />
                <BtnSimple css="btn--small" onClick={joinWithCode}>
                  Connect
                </BtnSimple>
              </div>
            </div>
          )}
          {codeMode !== 'idle' && (
            <div>
              <p><strong>Code:</strong> <span style={{ fontFamily: 'monospace', fontSize: '1.3em', letterSpacing: 2 }}>{pairCode}</span></p>
              <p style={{ color: '#ffa726' }}>{codeStatus}</p>
              <BtnSimple css="btn--small" onClick={cancelCode}>
                Cancel
              </BtnSimple>
            </div>
          )}
          {syncthingStatus !== 'running' && (
            <p style={{ color: '#888' }}>Start Syncthing to pair devices</p>
          )}
        </div>

        {/* Paired Devices */}
        <div style={sectionStyle}>
          <h3>Paired Devices</h3>
          {pairedDevices.length === 0 ? (
            <p style={{ color: '#888' }}>No paired devices yet</p>
          ) : (
            pairedDevices.map((dev, i) => (
              <div key={i} style={peerRowStyle}>
                <span style={{ color: dev.connected ? '#4caf50' : '#f44336' }}>●</span>
                <span>{dev.name}</span>
                <span style={{ fontSize: '0.8em', color: '#888', fontFamily: 'monospace' }}>
                  {dev.deviceId.substring(0, 16)}...
                </span>
                <BtnSimple css="btn--small" onClick={() => unpairDevice(dev.deviceId)}>
                  Unpair
                </BtnSimple>
              </div>
            ))
          )}
        </div>
      </Main>
      <Footer
        next="/cloud-sync-config"
        nextText="Back to Cloud Sync"
      />
    </Wrapper>
  );
}

const sectionStyle = {
  background: '#1e1e1e',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

const peerRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 0',
  borderBottom: '1px solid #333',
  flexWrap: 'wrap',
};

export default SyncthingCloudSyncPage;
