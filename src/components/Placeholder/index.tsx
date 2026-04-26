import React from 'react';
import { Card, Empty, Typography } from 'antd';
import { PageContainer } from '@ant-design/pro-components';

const { Paragraph } = Typography;

export const Placeholder: React.FC<{
  title: string;
  subTitle?: string;
  description?: string;
}> = ({ title, subTitle, description }) => (
  <PageContainer header={{ title, subTitle }}>
    <Card>
      <Empty
        description={
          <>
            <Paragraph strong style={{ marginBottom: 4 }}>{title}</Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {description || 'Screen stub — awaiting reference capture.'}
            </Paragraph>
          </>
        }
      />
    </Card>
  </PageContainer>
);

export default Placeholder;
