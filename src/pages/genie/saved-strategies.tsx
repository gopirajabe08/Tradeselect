import React from 'react';
import { ApiTable } from '@/components/ApiTable';
import { getPhoenixSavedColumns, getPhoenixSavedData } from '@/services/api';

export default function GenieSaved() {
  return (
    <ApiTable
      title="Saved Strategies"
      fetchColumns={getPhoenixSavedColumns}
      fetchData={(p) => getPhoenixSavedData(p)}
    />
  );
}
