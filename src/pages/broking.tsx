import React from 'react';
import { ApiTable } from '@/components/ApiTable';
import { getBrokingColumns, getBrokingData } from '@/services/api';

export default function Broking() {
  return (
    <ApiTable
      title="Broking Details"
      fetchColumns={getBrokingColumns}
      fetchData={(p) => getBrokingData(p)}
    />
  );
}
