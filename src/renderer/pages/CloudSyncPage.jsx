import { useTranslation } from 'react-i18next';
import React, { useState, useContext, useRef, useEffect } from 'react';
import { GlobalContext } from 'context/globalContext';
import Wrapper from 'components/molecules/Wrapper/Wrapper';

import Header from 'components/organisms/Header/Header';
import Footer from 'components/organisms/Footer/Footer';
import { useParams, useNavigate } from 'react-router-dom';
import CloudSync from 'components/organisms/Wrappers/CloudSync';
import { BtnSimple } from 'getbasecore/Atoms';

function CloudSyncPage() {
  const { t, i18n } = useTranslation();
  const { state, setState } = useContext(GlobalContext);
  const { type } = useParams();
  const { cloudSyncType, mode } = state;
  const navigate = useNavigate();
  const [statePage] = useState({
    disabledNext: false,
    disabledBack: false,
    disableButton: false,
    dom: undefined,
  });
  const { disabledNext, disabledBack, disableButton, dom } = statePage;

  const cloudSyncSet = (item) => {
    setState({
      ...state,
      cloudSyncType: item,
    });
  };
  const nextButtonStatus = () => {
    if (type === 'welcome') {
      return cloudSyncType === 'none' ? false : `cloud-sync-config/${type}`;
    }
    return cloudSyncType === 'none'
      ? 'copy-games'
      : `cloud-sync-config/${type}`;
  };

  return (
    <Wrapper>
      <Header title={t('CloudSyncPage.title')} />
      <p className="lead">{t('CloudSyncPage.description')}</p>
      <CloudSync
        onClick={cloudSyncSet}
        disableButton={disableButton}
        showNone={type !== 'welcome'}
      />

      <div style={{
        textAlign: 'center',
        padding: '16px 0',
        borderTop: '1px solid #333',
        marginTop: 16,
      }}>
        <p style={{ marginBottom: 12, color: '#aaa' }}>
          Or use P2P cloud sync (no account needed):
        </p>
        <BtnSimple
          css="btn--big"
          onClick={() => navigate('/syncthing-cloud-sync')}
        >
          Syncthing (P2P)
        </BtnSimple>
      </div>

      <Footer
        next={nextButtonStatus()}
        nextText={t('general.next')}
        disabledNext={disabledNext}
        disabledBack={type !== 'welcome'}
      />
    </Wrapper>
  );
}

export default CloudSyncPage;
