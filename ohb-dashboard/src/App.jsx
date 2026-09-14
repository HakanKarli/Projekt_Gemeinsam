import React, { useState, lazy, Suspense } from 'react';
import { MqttProvider } from './store/MqttContext';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import DashboardGrid from './components/DashboardGrid';
import AlertPanel from './components/AlertPanel';
import './index.css';

// Sekundäre Views & Modals werden bei Bedarf nachgeladen (Code-Splitting).
const RoomView        = lazy(() => import('./components/RoomView'));
const HistoryView     = lazy(() => import('./components/HistoryView'));
const ConnectionModal = lazy(() => import('./components/ConnectionModal'));
const ConfigPanel     = lazy(() => import('./components/ConfigPanel'));
const ReportPanel     = lazy(() => import('./components/ReportPanel'));

function ViewFallback() {
  return (
    <div className="dg-status">
      <div className="sp-spinner" />
      <span>Lädt…</span>
    </div>
  );
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [historyActive, setHistoryActive] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  function handleConfigClose() {
    setConfigOpen(false);
    setDataVersion((v) => v + 1);
  }

  function handleSelectRoom(room) {
    setSelectedRoom(room);
    setHistoryActive(false);
  }

  function handleSelectHistory() {
    setHistoryActive(true);
    setSelectedRoom(null);
  }

  /* Aktive Ansicht bestimmen */
  let mainContent;
  if (historyActive) {
    mainContent = <HistoryView />;
  } else if (selectedRoom) {
    mainContent = <RoomView room={selectedRoom} />;
  } else {
    mainContent = <DashboardGrid dataVersion={dataVersion} />;
  }

  return (
    <MqttProvider>
      <Header
        onSettingsOpen={() => setSettingsOpen(true)}
        onReportOpen={() => setReportOpen(true)}
        onAlertOpen={() => setAlertOpen(true)}
      />

      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onSelectRoom={handleSelectRoom}
        selectedRoom={selectedRoom}
        onConfigOpen={() => setConfigOpen(true)}
        historyActive={historyActive}
        onSelectHistory={handleSelectHistory}
        dataVersion={dataVersion}
      />

      <main className={`app-body ${sidebarOpen ? 'app-with-sidebar' : 'app-no-sidebar'}`}>
        <Suspense fallback={<ViewFallback />}>
          {mainContent}
        </Suspense>
      </main>

      <Suspense fallback={null}>
        {settingsOpen && <ConnectionModal onClose={() => setSettingsOpen(false)} />}
        {configOpen && <ConfigPanel onClose={handleConfigClose} />}
        {reportOpen && <ReportPanel onClose={() => setReportOpen(false)} />}
      </Suspense>

      <AlertPanel open={alertOpen} onClose={() => setAlertOpen(false)} />
    </MqttProvider>
  );
}
