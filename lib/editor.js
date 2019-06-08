/* @flow */

import type {
  Emitter,
  DisplayMarker,
  TextEditor,
  CompositeDisposable
} from 'atom'

import debounce from 'sb-debounce'
import disposableEvent from 'disposable-event'
import Disposable from 'atom'
import type { LinterMessage } from '@atom/linter'
import Tooltip from './components/tooltip'
import { $range, filterMessagesByRangeOrPoint } from './components/helpers'
import { hasParent, mouseEventNearPosition, getBufferPositionFromMouseEvent } from './helpers'

const $ = require('lazy-cache')(require)
$('atom')
$('./util', 'util')

// TODO: Add config option to remove gutter decorations
// TODO: Add config option to control position of gutter decorations (?)

class Editor {
  markers: Map<LinterMessage, DisplayMarker>
  messages: Set<LinterMessage>
  textEditor: TextEditor
  emitter: Emitter
  tooltip: ?Tooltip
  tooltipFollows: string
  subscriptions: CompositeDisposable

  constructor (textEditor: TextEditor, initialMessages: LinterMessage[]) {
    this.tooltip = null
    this.textEditor = textEditor
    this.markers = new Map()
    this.messages = new Set()
    this.emitter = new $.atom.Emitter()
    this.subscriptions = new $.atom.CompositeDisposable()
    this.subscriptions.add(this.emitter)

    this.subscriptions.add(textEditor.onDidDestroy(() => {
      this.destroy()
    }))
    this.subscriptions.add(
      atom.config.observe('linter-ui-ultra.showTooltip', showTooltip => {
        this.showTooltip = showTooltip
        if (!this.showTooltip && this.tooltip) {
          this.removeTooltip()
        }
      }),
    )

    let tooltipSubscription
    this.subscriptions.add(
      atom.config.observe('linter-ui-ultra.tooltipFollows', tooltipFollows => {
        this.tooltipFollows = tooltipFollows
        if (tooltipSubscription) {
          tooltipSubscription.dispose()
        }
        tooltipSubscription = new CompositeDisposable()
        if (tooltipFollows === 'Mouse' || tooltipFollows === 'Both') {
          tooltipSubscription.add(this.listenForMouseMovement())
        }
        if (tooltipFollows === 'Keyboard' || tooltipFollows === 'Both') {
          tooltipSubscription.add(this.listenForKeyboardMovement())
        }
        this.removeTooltip()
      }),
    )/*
    this.subscriptions.add(
      new Disposable(function() {
        tooltipSubscription.dispose()
      }),
    )*/


    const lastCursorPositions = new WeakMap();
    this.subscriptions.add(
      textEditor.onDidChangeCursorPosition(({ cursor, newBufferPosition }) => {
        const lastBufferPosition = lastCursorPositions.get(cursor)
        if (!lastBufferPosition || !lastBufferPosition.isEqual(newBufferPosition)) {
          lastCursorPositions.set(cursor, newBufferPosition)
          this.ignoreTooltipInvocation = false
        }
        if (this.tooltipFollows === 'Mouse') {
          this.removeTooltip()
        }
      }),
    )
    this.subscriptions.add(
      textEditor.getBuffer().onDidChangeText(() => {
        const cursors = textEditor.getCursors()
        cursors.forEach(cursor => {
          lastCursorPositions.set(cursor, cursor.getBufferPosition())
        })
        if (this.tooltipFollows !== 'Mouse') {
          this.ignoreTooltipInvocation = true
          this.removeTooltip()
        }
      }),
    )

    // Add a gutter to hold a warning/error/info decoration for
    // any linter messages on the line
    this.gutter = this.textEditor.addGutter({
      name: 'linter-ui-ultra',
      priority: 100
    })

    // TODO: Talk with someone from atom about marker layers in combination with gutter decorations
    //       It makes sense that they can't work for `item` but they _should_ be able to work for extending the
    //       line selection highlight to custom gutters
    //
    // BUG: The below should be sufficient for extending line selection highlight to this custom gutter. The problem is missing `onlyHead` support for gutter decorations.

    this.textEditor.decorateMarkerLayer(this.textEditor.selectionsMarkerLayer, {
      gutterName: 'linter-ui-ultra',
      type: 'gutter',
      class: 'line-number cursor-line-no-selection',
      onlyEmpty: true,
      onlyHead: true
    })

    this.textEditor.decorateMarkerLayer(this.textEditor.selectionsMarkerLayer, {
      gutterName: 'linter-ui-ultra',
      type: 'gutter',
      class: 'line-number cursor-line'
    })

    // Add each initial message
    for (const initialMessage of initialMessages) {
      this.addMessage(initialMessage)
    }
  }

  destroy () {
    this.emitter.emit('did-destroy')

    try {
      this.gutter.destroy()
    } catch (_) {
      // This throws when the text editor is disposed
    }

    this.subscriptions.dispose()
  }

  onDidDestroy (fn: () => *) {
    this.emitter.on('did-destroy', fn)
  }

  listenForMouseMovement() {
    const editorElement = atom.views.getView(this.textEditor)

    return disposableEvent(
      editorElement,
      'mousemove',
      debounce(
        event => {
          if (!editorElement.component || this.subscriptions.disposed || !hasParent(event.target, 'div.scroll-view')) {
            return
          }
          const tooltip = this.tooltip
          if (
            tooltip &&
            mouseEventNearPosition({
              event,
              editor: this.textEditor,
              editorElement,
              tooltipElement: tooltip.element,
              screenPosition: tooltip.marker.getStartScreenPosition(),
            })
          ) {
            return
          }

          this.cursorPosition = getBufferPositionFromMouseEvent(event, this.textEditor, editorElement)
          this.ignoreTooltipInvocation = false
          if (this.textEditor.largeFileMode) {
            // NOTE: Ignore if file is too large
            this.cursorPosition = null
          }
          if (this.cursorPosition) {
            this.updateTooltip(this.cursorPosition)
          } else {
            this.removeTooltip()
          }
        },
        300,
        true,
      ),
    )
  }
  updateTooltip(position: ?Point) {
    if (!position || (this.tooltip && this.tooltip.isValid(position, this.messages))) {
      return
    }
    this.removeTooltip()
    if (!this.showTooltip) {
      return
    }
    if (this.ignoreTooltipInvocation) {
      return
    }

    const messages = filterMessagesByRangeOrPoint(this.messages, this.textEditor.getPath(), position)
    if (!messages.length) {
      return
    }

    this.tooltip = new Tooltip(messages, position, this.textEditor)
    this.tooltip.onDidDestroy(() => {
      this.tooltip = null
    })
  }
  removeTooltip() {
    if (this.tooltip) {
      this.tooltip.marker.destroy()
    }
  }

  listenForKeyboardMovement() {
    return this.textEditor.onDidChangeCursorPosition(
      debounce(({ newBufferPosition }) => {
        this.cursorPosition = newBufferPosition
        this.updateTooltip(newBufferPosition)
      }, 16),
    )
  }

  addMessage (message: LinterMessage) {
    const marker = this.textEditor.markBufferRange($.util.$range(message), {
      invalidate: 'never'
    })

    marker.onDidChange(
      ({ isValid, oldHeadBufferPosition, newHeadBufferPosition }) => {
        if (
          !isValid ||
          (newHeadBufferPosition.row === 0 && oldHeadBufferPosition.row !== 0)
        ) {
          // This marker is invalid; ignore it
          return
        }

        // This marker is valid; the message just moved
        // New lines entered above, etc.
        if (message.version === 1) {
          message.range = marker.bufferMarker.previousEventState.range
        } else {
          message.location.position =
            marker.bufferMarker.previousEventState.range
        }
      }
    )
    // Remember the marker so we can destroy it later when somebody fixes
    // the lint message
    this.markers.set(message, marker)
    this.messages.add(message)

    // TODO: Make sure we _only_ decorate the greatest intensity message
    //       We probably need to collect messages by line number and
    //       mark/decorate that way

    const item = document.createElement('span')
    item.className = `luip-icon luip-icon-${message.severity}`

    this.textEditor.decorateMarker(marker, {
      type: 'gutter',
      gutterName: 'linter-ui-ultra',
      class: 'linter-gutter-marker',
      item
    })

    // TODO: This can use a set of 3 marker layers and should for a big
    //       speed up

    this.textEditor.decorateMarker(marker, {
      type: 'highlight',
      class: `linter-highlight-${message.severity}`
    })
  }

  removeMessage (message: LinterMessage) {
    // Remove the marker corresponding to this message from the editor
    const marker = this.markers.get(message)
    if (marker != null) {
      marker.destroy()
      this.markers.delete(message)
      this.messages.delete(message)
    }
  }
}

module.exports = Editor
