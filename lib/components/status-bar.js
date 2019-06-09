/* @flow */
/* @jsx etch.dom */

const lazyImport = require('import-lazy')(require)
const etch = lazyImport('../etch')

import { CompositeDisposable } from 'atom'

type Props = {
  onClick: () => *,
  messageCountsBySeverity: { warning: number, error: number, info: number }
}

class StatusBar {
  props: Props
  element: any
  _tile: any
  _registry: any

  subscriptions: CompositeDisposable

  constructor (statusBarRegistry: any, props: Props) {
    this.props = props
    this._registry = statusBarRegistry

    etch.initialize(this)

    this.subscriptions = new CompositeDisposable()

    this.subscriptions.add(atom.tooltips.add(this.element.getElementsByClassName('tile-error')[0], { title: 'Erros' }))
    this.subscriptions.add(atom.tooltips.add(this.element.getElementsByClassName('tile-warning')[0], { title: 'Avisos' }))
    this.subscriptions.add(atom.tooltips.add(this.element.getElementsByClassName('tile-info')[0], { title: 'Informações' }))

    atom.config.observe('linter-ui-ultra-portuguese.showInStatusBar', this.attach)
    atom.config.observe('linter-ui-ultra-portuguese.statusBarPosition', this.attach)
  }

  update () {}

  updateMessageCounts (messageCountsBySeverity: {
    warning: number,
    error: number,
    info: number
  }) {
    this.props.messageCountsBySeverity = messageCountsBySeverity

    etch.update(this)
  }

  destroy () {
    this._tile.destroy()
    etch.destroy(this)
  }

  render () {
    return (
      <div
        className='inline-block linter-ui-ultra-portuguese status-bar'
        on={{ click: this.props.onClick }}
      >
        {['error', 'warning', 'info'].map(severity =>
          <span
            class={`tile tile-${severity}`}
            attributes={{
              'data-count': this.props.messageCountsBySeverity[severity]
            }}
          >
            {this.props.messageCountsBySeverity[severity]}
          </span>
        )}
      </div>
    )
  }

  attach = () => {
    if (this._tile != null) this._tile.destroy()
    if (!atom.config.get('linter-ui-ultra-portuguese.showInStatusBar')) return

    // TODO: Config option for position
    const position = atom.config.get('linter-ui-ultra-portuguese.statusBarPosition')
    this._tile = this._registry[`add${position}Tile`]({
      item: this.element,
      priority: position === 'Left' ? 0 : -100
    })
  }
}

module.exports = StatusBar
