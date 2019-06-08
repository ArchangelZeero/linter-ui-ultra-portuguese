/* @flow */

import React from 'react'

export default ({ onClick }: { onClick: () => void }) => (
  <button className="linter-ui-ultra-fix-btn" onClick={onClick}>
    Fix
  </button>
)
