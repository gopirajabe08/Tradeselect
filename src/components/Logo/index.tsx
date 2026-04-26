import React from 'react';

export const Logo: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        background: 'linear-gradient(135deg,#1677ff 0%,#52c41a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 700,
      }}
    >
      T
    </div>
    <span style={{ color: '#fff', fontWeight: 600, letterSpacing: 0.3 }}>TradeAuto</span>
  </div>
);
