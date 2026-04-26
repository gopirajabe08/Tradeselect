import React from 'react';
import { Tabs, Card } from 'antd';
import { ApiTable } from '@/components/ApiTable';
import {
  getWalletActivePlansColumn,
  getWalletActivePlansData,
  getWalletExpiredPlansColumn,
  getWalletExpiredPlansData,
  getWalletPayAsYouGoColumn,
  getWalletPayAsYouGoData,
} from '@/services/api';

export default function MyPlans() {
  return (
    <Card title="My Plans" size="small">
      <Tabs
        items={[
          {
            key: 'active',
            label: 'Active Plans',
            children: (
              <ApiTable
                fetchColumns={getWalletActivePlansColumn}
                fetchData={(p) => getWalletActivePlansData(p)}
              />
            ),
          },
          {
            key: 'expired',
            label: 'Expired Plans',
            children: (
              <ApiTable
                fetchColumns={getWalletExpiredPlansColumn}
                fetchData={(p) => getWalletExpiredPlansData(p)}
              />
            ),
          },
          {
            key: 'payg',
            label: 'Pay As You Go',
            children: (
              <ApiTable
                fetchColumns={getWalletPayAsYouGoColumn}
                fetchData={(p) => getWalletPayAsYouGoData(p)}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
