import React from 'react';
import { ApiTable } from '@/components/ApiTable';
import { getPhoenixSavedColumns, getPhoenixSavedData } from '@/services/api';

export default function PhoenixMyAll() {
  return (
    <ApiTable
      title="All My Strategies"
      fetchColumns={getPhoenixSavedColumns}
      fetchData={(p) => getPhoenixSavedData(p)}
    />
  );
}
