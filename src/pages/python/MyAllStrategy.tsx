import React from 'react';
import { ApiTable } from '@/components/ApiTable';
import { getPhoenixSavedColumns, getPhoenixSavedData } from '@/services/api';

export default function PythonMyAll() {
  return (
    <ApiTable
      title="Python Strategies"
      fetchColumns={getPhoenixSavedColumns}
      fetchData={(p) => getPhoenixSavedData(p)}
    />
  );
}
